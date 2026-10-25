import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { CorrespondenceDocuments } from './correspondence-documents'
import { ContactRepository } from './contacts'
import { EmailConfiguration } from './email-configuration'
import { emailAddress, withinEmailRetryWindow, type ProviderEmail } from './email-model'
import { EmailProviderError, ResendEmailProvider, type EmailRuntime } from './email-provider'
import { commitCRM, replayCRM } from './mutations'
import { SiteConflictError } from '../organizations/atomic'
export async function emailDigest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}
export interface QueuedEmailPayload {
  message: Omit<ProviderEmail, 'headers' | 'attachments'>
  attachment?: { objectKey: string; sha256: string; bytes: number; filename: string }
}
export interface EmailQueueRequest {
  site: string
  document: string
  recipient: string
  includePDF: boolean
}
export interface EmailOutboxRow {
  id: string
  site_id: string
  document_id: string
  actor_id: number
  constituent_id: string
  provider: string
  settings_revision: number
  contact_revision: number
  payload: string
  payload_hash: string
  idempotency_key: string
  status: string
  provider_id: string | null
  first_attempt_at: string | null
  uncertain_since: string | null
  attempts: number
  fence: number
  lease_until: string | null
  next_attempt_at: string
  next_reconcile_at: string | null
  last_provider_event: string | null
  error: string | null
  cancel_requested: number
  revision: number
  created_at: string
  updated_at: string
}
export class EmailOutbox {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
    private runtime: EmailRuntime,
    private now: () => number = Date.now,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async prepare(input: EmailQueueRequest) {
    const site = await this.authority.require(input.site, 'communications', 'edit')
    const documents = new CorrespondenceDocuments(this.db, this.actor),
      document = await documents.get(input.site, input.document)
    const contact = await new ContactRepository(this.db, this.actor).get(
      input.site,
      document.constituent_id,
    )
    const recipient = emailAddress(input.recipient)
    if (
      !contact.profile.communication.emailAllowed ||
      !contact.profile.methods.some((method) => {
        if (method.kind !== 'email') return false
        try {
          return emailAddress(method.value) === recipient
        } catch {
          return false
        }
      })
    )
      throw new Error('Use a recorded recipient who permits email correspondence.')
    const superseded = await this.db
      .prepare('SELECT id FROM vc_crm_documents WHERE supersedes_id=?')
      .bind(document.id)
      .first()
    if (superseded) throw new Error('Use the corrected document for new correspondence.')
    const settings = await new EmailConfiguration(this.db, this.actor, this.runtime).forDelivery(
      input.site,
    )
    const sender = settings.values
    const issuer = (JSON.parse(document.snapshot) as { issuer: { name: string; address: string } })
      .issuer
    const message: QueuedEmailPayload['message'] = {
      from: sender.senderName ? `${sender.senderName} <${sender.senderEmail}>` : sender.senderEmail,
      to: [recipient],
      subject: document.subject,
      text: `${document.subject}\n\n${document.body}\n\n${[issuer.name, issuer.address, document.id, document.issued_on].filter(Boolean).join('\n')}`,
      html: await documents.printable(input.site, document.id),
      ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
    }
    if (!message.subject.trim() || /[\r\n]/.test(message.subject))
      throw new Error('Use a document with a valid single-line email subject.')
    const payload: QueuedEmailPayload = { message }
    if (input.includePDF) {
      const file = await this.db
        .prepare('SELECT object_key,sha256,bytes FROM vc_crm_document_files WHERE document_id=?')
        .bind(document.id)
        .first<{ object_key: string; sha256: string; bytes: number }>()
      if (!file) throw new Error('Use a completed document PDF before attaching it to email.')
      payload.attachment = {
        objectKey: file.object_key,
        sha256: file.sha256,
        bytes: file.bytes,
        filename: `document-${document.id}.pdf`,
      }
    }
    const current = await this.authority.require(input.site, 'communications', 'edit')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return {
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      document: document.id,
      constituent: contact.id,
      contactRevision: contact.revision,
      affiliationRevision: contact.affiliationRevision,
      settingsRevision: settings.revision,
      payload,
    }
  }
  async preview(input: EmailQueueRequest) {
    const prepared = await this.prepare(input)
    return {
      approval: await emailDigest(JSON.stringify(prepared)),
      from: prepared.payload.message.from,
      recipient: prepared.payload.message.to[0],
      subject: prepared.payload.message.subject,
      text: prepared.payload.message.text,
      attachment: prepared.payload.attachment
        ? {
            filename: prepared.payload.attachment.filename,
            bytes: prepared.payload.attachment.bytes,
          }
        : null,
      deliveryReference: 'Assigned when queued and included in the retained email copy.',
    }
  }
  async context(site: string, documentID: string) {
    const documents = new CorrespondenceDocuments(this.db, this.actor),
      document = await documents.get(site, documentID)
    const contact = await new ContactRepository(this.db, this.actor).get(
      site,
      document.constituent_id,
    )
    const existing = await this.db
      .prepare(
        'SELECT id,actor_id,contact_revision,settings_revision FROM vc_crm_email_outbox WHERE document_id=? AND site_id=?',
      )
      .bind(documentID, site)
      .first<{
        id: string
        actor_id: number
        contact_revision: number
        settings_revision: number
      }>()
    const superseded = !!(await this.db
      .prepare('SELECT id FROM vc_crm_documents WHERE supersedes_id=?')
      .bind(documentID)
      .first())
    const canEdit = (await this.authority.authority(site, 'communications', 'edit')).allowed
    let configured = false
    let settingsRevision = 0
    if (canEdit)
      try {
        settingsRevision = (
          await new EmailConfiguration(this.db, this.actor, this.runtime).forDelivery(site)
        ).revision
        configured = true
      } catch (error) {
        if (!(error instanceof EmailProviderError)) throw error
      }
    const recipients: string[] = []
    if (contact.profile.communication.emailAllowed)
      for (const method of contact.profile.methods) {
        if (method.kind === 'email')
          try {
            const address = emailAddress(method.value)
            if (!recipients.includes(address)) recipients.push(address)
          } catch {
            /* Unsupported addresses are excluded from sending, not rewritten. */
          }
      }
    const delivery = existing ? await this.get(site, existing.id) : null
    const pdfReady = !!(await this.db
      .prepare('SELECT document_id FROM vc_crm_document_files WHERE document_id=?')
      .bind(documentID)
      .first())
    await documents.get(site, documentID)
    return {
      delivery,
      pdfReady,
      recipients,
      configured,
      emailAllowed: contact.profile.communication.emailAllowed,
      superseded,
      canQueue: canEdit && configured && !existing && !superseded && !!recipients.length,
      canReconcile:
        canEdit && new ResendEmailProvider(this.runtime).configured && !!delivery?.firstAttemptAt,
      canCancel:
        canEdit &&
        !!delivery &&
        !delivery.providerID &&
        ['pending', 'sending', 'uncertain', 'failed'].includes(delivery.status),
      canRetry:
        canEdit &&
        configured &&
        contact.profile.communication.emailAllowed &&
        existing?.contact_revision === contact.revision &&
        existing?.settings_revision === settingsRevision &&
        existing?.actor_id === this.actor &&
        !!delivery &&
        !delivery.providerID &&
        !superseded &&
        ['failed', 'cancelled', 'uncertain'].includes(delivery.status) &&
        (!delivery.firstAttemptAt || withinEmailRetryWindow(delivery.firstAttemptAt, this.now())),
    }
  }
  async queue(input: EmailQueueRequest & { approval: string; operationKey: string }) {
    await this.authority.require(input.site, 'communications', 'edit')
    await new CorrespondenceDocuments(this.db, this.actor).get(input.site, input.document)
    const intent = {
      document: input.document,
      recipient: emailAddress(input.recipient),
      includePDF: input.includePDF,
      approval: input.approval,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'email.queued',
      type: 'email-delivery',
      intent,
    })
    if (replay) {
      await this.get(input.site, String(replay.id))
      return replay
    }
    const prepared = await this.prepare(input)
    if ((await emailDigest(JSON.stringify(prepared))) !== input.approval)
      throw new SiteConflictError()
    const id = crypto.randomUUID(),
      now = new Date().toISOString()
    const message = prepared.payload.message
    const reference = `Delivery reference: ${id}`
    const payload = JSON.stringify({
      ...prepared.payload,
      message: {
        ...message,
        text: `${message.text}\n\n${reference}`,
        html: message.html.replace('</body>', `<p>${reference}</p></body>`),
      },
    })
    const guards: D1PreparedStatement[] = []
    const guard = (suffix: string, sql: string, values: (string | number)[]) => {
      guards.push(
        this.db
          .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
          .bind(`${input.operationKey}:${suffix}`, ...values),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:${suffix}`),
      )
    }
    guard(
      'recipient',
      'SELECT ?,count(*) FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE c.id=? AND c.revision=? AND c.archived=0 AND a.site_id=? AND a.revision=? AND a.archived=0',
      [prepared.constituent, prepared.contactRevision, input.site, prepared.affiliationRevision],
    )
    guard(
      'settings',
      "SELECT ?,count(*) FROM vc_crm_email_settings WHERE site_id=? AND revision=? AND enabled=1 AND provider='resend' AND verified_at IS NOT NULL",
      [input.site, prepared.settingsRevision],
    )
    guard(
      'document',
      'SELECT ?,count(*) FROM vc_crm_documents d WHERE d.id=? AND d.site_id=? AND NOT EXISTS(SELECT 1 FROM vc_crm_documents n WHERE n.supersedes_id=d.id)',
      [prepared.document, input.site],
    )
    guards.push(
      this.db
        .prepare(
          "INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,actor_id,created_at) VALUES(?,?,0,'queued',?,?)",
        )
        .bind(crypto.randomUUID(), id, this.actor, now),
    )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: prepared.organization,
      authorityRevision: prepared.authorityRevision,
      action: 'email.queued',
      type: 'email-delivery',
      id,
      after: { document: prepared.document },
      intent,
      write: this.db
        .prepare(
          "INSERT INTO vc_crm_email_outbox(id,site_id,document_id,actor_id,constituent_id,provider,settings_revision,contact_revision,payload,payload_hash,idempotency_key,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,'resend',?,?,?,?,?,?,?,?) ON CONFLICT(document_id) DO NOTHING",
        )
        .bind(
          id,
          input.site,
          prepared.document,
          this.actor,
          prepared.constituent,
          prepared.settingsRevision,
          prepared.contactRevision,
          payload,
          await emailDigest(payload),
          `vorticause:${id}`,
          now,
          now,
          now,
        ),
      dependent: guards,
      result: { id },
    })
  }
  async get(site: string, id: string) {
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_email_outbox WHERE id=? AND site_id=?')
      .bind(id, site)
      .first<EmailOutboxRow>()
    if (!row) throw new SiteAccessError()
    await new CorrespondenceDocuments(this.db, this.actor).get(site, row.document_id)
    const message = (JSON.parse(row.payload) as QueuedEmailPayload).message
    return {
      id: row.id,
      document: row.document_id,
      status: row.status,
      providerID: row.provider_id,
      recipient: message.to[0],
      from: message.from,
      subject: message.subject,
      attempts: row.attempts,
      revision: row.revision,
      error: row.error,
      firstAttemptAt: row.first_attempt_at,
      nextAttemptAt: row.next_attempt_at,
      cancelRequested: !!row.cancel_requested,
    }
  }
  async control(input: {
    site: string
    id: string
    expectedRevision: number
    action: 'cancel' | 'retry'
    operationKey: string
  }) {
    const site = await this.authority.require(input.site, 'communications', 'edit')
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_email_outbox WHERE id=? AND site_id=?')
      .bind(input.id, input.site)
      .first<EmailOutboxRow>()
    if (!row) throw new SiteAccessError()
    await new CorrespondenceDocuments(this.db, this.actor).get(input.site, row.document_id)
    const intent = { id: input.id, expectedRevision: input.expectedRevision, action: input.action }
    const action =
      input.action === 'cancel' ? 'email.cancellation.requested' : 'email.retry.requested'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'email-delivery',
      intent,
    })
    if (replay) return replay
    if (!Number.isSafeInteger(input.expectedRevision) || row.revision !== input.expectedRevision)
      throw new SiteConflictError()
    if (row.provider_id)
      throw new Error('This delivery was accepted by the provider and cannot be unsent or retried.')
    const now = new Date(this.now()).toISOString()
    const dependent: D1PreparedStatement[] = []
    let status: string, write: D1PreparedStatement
    if (input.action === 'retry') {
      if (row.actor_id !== this.actor) throw new SiteAccessError()
      if (!['failed', 'cancelled', 'uncertain'].includes(row.status)) throw new SiteConflictError()
      if (row.first_attempt_at && !withinEmailRetryWindow(row.first_attempt_at, this.now()))
        throw new Error('Use provider reconciliation before retrying an expired delivery attempt.')
      const payload = JSON.parse(row.payload) as QueuedEmailPayload
      const prepared = await this.prepare({
        site: input.site,
        document: row.document_id,
        recipient: payload.message.to[0],
        includePDF: !!payload.attachment,
      })
      if (
        prepared.settingsRevision !== row.settings_revision ||
        prepared.contactRevision !== row.contact_revision ||
        (await emailDigest(row.payload)) !== row.payload_hash
      )
        throw new SiteConflictError()
      const guard = (suffix: string, sql: string, params: (string | number)[]) => {
        dependent.push(
          this.db
            .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
            .bind(`${input.operationKey}:${suffix}`, ...params),
          this.db
            .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
            .bind(`${input.operationKey}:${suffix}`),
        )
      }
      guard(
        'recipient',
        'SELECT ?,count(*) FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE c.id=? AND c.revision=? AND c.archived=0 AND a.site_id=? AND a.revision=? AND a.archived=0',
        [row.constituent_id, row.contact_revision, input.site, prepared.affiliationRevision],
      )
      guard(
        'settings',
        "SELECT ?,count(*) FROM vc_crm_email_settings WHERE site_id=? AND revision=? AND enabled=1 AND provider='resend'",
        [input.site, row.settings_revision],
      )
      status = 'pending'
      write = this.db
        .prepare(
          "UPDATE vc_crm_email_outbox SET status='pending',cancel_requested=0,fence=fence+1,lease_until=NULL,error=NULL,next_attempt_at=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=? AND provider_id IS NULL",
        )
        .bind(now, now, row.id, input.site, input.expectedRevision)
    } else {
      if (!['pending', 'sending', 'uncertain', 'failed'].includes(row.status))
        throw new SiteConflictError()
      const uncertain =
        !!row.uncertain_since || (row.status === 'sending' && !!row.first_attempt_at)
      status = uncertain ? 'uncertain' : 'cancelled'
      write = this.db
        .prepare(
          "UPDATE vc_crm_email_outbox SET status=?,cancel_requested=1,uncertain_since=CASE WHEN ?=1 THEN COALESCE(uncertain_since,?) ELSE uncertain_since END,fence=fence+1,lease_until=NULL,error=?,next_attempt_at='9999-12-31T23:59:59.999Z',revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=? AND provider_id IS NULL",
        )
        .bind(
          status,
          uncertain ? 1 : 0,
          now,
          uncertain ? 'Cancellation requested. Reconcile any in-flight provider outcome.' : null,
          now,
          row.id,
          input.site,
          input.expectedRevision,
        )
    }
    dependent.push(
      this.db
        .prepare(
          'INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,actor_id,created_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          row.fence + 1,
          input.action === 'cancel' ? 'cancellation-requested' : 'retry-requested',
          this.actor,
          now,
        ),
    )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'email-delivery',
      id: row.id,
      before: { status: row.status },
      after: { status },
      intent,
      write,
      dependent,
      result: { id: row.id, status },
    })
  }
  async events(site: string, id: string, beforeDate = '', beforeID = '') {
    await this.get(site, id)
    if (
      !!beforeDate !== !!beforeID ||
      (beforeDate && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(beforeDate))
    )
      throw new Error('Invalid page cursor.')
    const rows = await this.db
      .prepare(
        "SELECT id,event,provider_id,actor_id,detail,created_at FROM vc_crm_email_events WHERE outbox_id=? AND (?='' OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 51",
      )
      .bind(id, beforeDate, beforeDate, beforeDate, beforeID)
      .all<{
        id: string
        event: string
        provider_id: string | null
        actor_id: number | null
        detail: string
        created_at: string
      }>()
    await this.get(site, id)
    return {
      docs: rows.results.slice(0, 50),
      next:
        rows.results.length > 50
          ? { date: rows.results[49].created_at, id: rows.results[49].id }
          : null,
    }
  }
}
