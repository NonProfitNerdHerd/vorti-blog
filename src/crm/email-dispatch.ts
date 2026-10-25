import { Buffer } from 'node:buffer'
import { atomicSiteMutation } from '../organizations/atomic'
import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { ContactRepository } from './contacts'
import { CorrespondenceDocuments } from './correspondence-documents'
import { EmailConfiguration } from './email-configuration'
import { emailDigest, type EmailOutboxRow, type QueuedEmailPayload } from './email-outbox'
import { emailAddress, withinEmailRetryWindow, type ProviderEmail } from './email-model'
import { EmailProviderError, ResendEmailProvider, type EmailRuntime } from './email-provider'
/** External dispatch is preceded by an atomic authorization checkpoint, never hidden in a D1 transaction. */
export class EmailDispatcher {
  private provider: ResendEmailProvider
  constructor(
    private db: D1Database,
    private storage: R2Bucket,
    private runtime: EmailRuntime,
    transport?: typeof fetch,
    private now: () => number = Date.now,
  ) {
    this.provider = new ResendEmailProvider(runtime, transport)
  }
  async tick(): Promise<boolean> {
    if (!this.provider.canSend) return false
    const timestamp = new Date(this.now()).toISOString()
    const candidate = await this.db
      .prepare(
        "SELECT * FROM vc_crm_email_outbox WHERE provider_id IS NULL AND cancel_requested=0 AND next_attempt_at<=? AND (status IN('pending','uncertain') OR (status='sending' AND lease_until<=?)) ORDER BY next_attempt_at,id LIMIT 1",
      )
      .bind(timestamp, timestamp)
      .first<EmailOutboxRow>()
    if (!candidate) return false
    const lease = new Date(this.now() + 120000).toISOString()
    const claimed = await this.db.batch([
      this.db
        .prepare(
          "UPDATE vc_crm_email_outbox SET uncertain_since=CASE WHEN status='sending' AND first_attempt_at IS NOT NULL THEN COALESCE(uncertain_since,?) ELSE uncertain_since END,status='sending',fence=fence+1,lease_until=?,revision=revision+1,updated_at=? WHERE id=? AND fence=? AND provider_id IS NULL AND cancel_requested=0 AND (status IN('pending','uncertain') OR (status='sending' AND lease_until<=?))",
        )
        .bind(timestamp, lease, timestamp, candidate.id, candidate.fence, timestamp),
      this.db
        .prepare(
          "INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,actor_id,created_at) SELECT ?,?,?,'claimed',?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          candidate.id,
          candidate.fence + 1,
          candidate.actor_id,
          timestamp,
        ),
    ])
    if (claimed[0].meta.changes !== 1) return false
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_email_outbox WHERE id=? AND fence=?')
      .bind(candidate.id, candidate.fence + 1)
      .first<EmailOutboxRow>()
    if (!row) return true
    let dispatched = false
    let confirmedID: string | null = null
    try {
      if (row.first_attempt_at && !withinEmailRetryWindow(row.first_attempt_at, this.now()))
        throw new EmailProviderError('reconcile')
      const authority = new OrganizationRepository(this.db, row.actor_id)
      const site = await authority.require(row.site_id, 'communications', 'edit')
      const documents = new CorrespondenceDocuments(this.db, row.actor_id)
      await documents.get(row.site_id, row.document_id)
      const contact = await new ContactRepository(this.db, row.actor_id).get(
        row.site_id,
        row.constituent_id,
      )
      const settings = await new EmailConfiguration(
        this.db,
        row.actor_id,
        this.runtime,
      ).forDelivery(row.site_id)
      if (
        settings.revision !== row.settings_revision ||
        contact.revision !== row.contact_revision ||
        !contact.profile.communication.emailAllowed ||
        (await emailDigest(row.payload)) !== row.payload_hash
      )
        throw new Error('Review required')
      const payload = JSON.parse(row.payload) as QueuedEmailPayload
      const recipient = emailAddress(payload.message.to[0])
      if (
        !contact.profile.methods.some((method) => {
          if (method.kind !== 'email') return false
          try {
            return emailAddress(method.value) === recipient
          } catch {
            return false
          }
        })
      )
        throw new Error('Review required')
      const wire: ProviderEmail = {
        ...payload.message,
        headers: { 'X-VortiCause-Delivery': row.id },
      }
      if (payload.attachment) {
        const file = payload.attachment
        if (
          Math.ceil(file.bytes / 3) * 4 +
            new TextEncoder().encode(JSON.stringify(wire)).length +
            512 >
          40000000
        )
          throw new EmailProviderError('rejected')
        const object = await this.storage.get(file.objectKey)
        if (!object || object.size !== file.bytes) throw new Error('Review required')
        const bytes = await object.arrayBuffer()
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (byte) => byte.toString(16).padStart(2, '0'),
        ).join('')
        if (hash !== file.sha256) throw new Error('Review required')
        wire.attachments = [
          { filename: file.filename, content: Buffer.from(bytes).toString('base64') },
        ]
      }
      const dispatchTime = new Date(this.now()).toISOString(),
        key = crypto.randomUUID(),
        guards: D1PreparedStatement[] = []
      const guard = (suffix: string, sql: string, values: (string | number)[]) => {
        guards.push(
          this.db
            .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
            .bind(`${key}:${suffix}`, ...values),
          this.db
            .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
            .bind(`${key}:${suffix}`),
        )
      }
      guard(
        'authority',
        'SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
        [site.organization_id, site.authorityRevision],
      )
      guard(
        'recipient',
        'SELECT ?,count(*) FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE c.id=? AND c.revision=? AND c.archived=0 AND a.site_id=? AND a.revision=? AND a.archived=0',
        [row.constituent_id, row.contact_revision, row.site_id, contact.affiliationRevision],
      )
      guard(
        'settings',
        "SELECT ?,count(*) FROM vc_crm_email_settings WHERE site_id=? AND revision=? AND enabled=1 AND provider='resend' AND verified_at IS NOT NULL",
        [row.site_id, row.settings_revision],
      )
      guard(
        'document',
        'SELECT ?,count(*) FROM vc_crm_documents d WHERE d.id=? AND d.site_id=? AND NOT EXISTS(SELECT 1 FROM vc_crm_documents n WHERE n.supersedes_id=d.id)',
        [row.document_id, row.site_id],
      )
      guards.push(
        this.db
          .prepare(
            "INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,actor_id,created_at) VALUES(?,?,?,'dispatch-started',?,?)",
          )
          .bind(crypto.randomUUID(), row.id, row.fence, row.actor_id, dispatchTime),
      )
      await atomicSiteMutation(this.db, {
        actor: row.actor_id,
        operationKey: key,
        fingerprint: row.payload_hash,
        write: this.db
          .prepare(
            "UPDATE vc_crm_email_outbox SET first_attempt_at=COALESCE(first_attempt_at,?),attempts=attempts+1,revision=revision+1,updated_at=? WHERE id=? AND fence=? AND status='sending' AND lease_until>? AND cancel_requested=0 AND provider_id IS NULL",
          )
          .bind(dispatchTime, dispatchTime, row.id, row.fence, dispatchTime),
        afterWrite: guards,
        result: { id: row.id },
      })
      dispatched = true
      const id = await this.provider.send(
        wire,
        row.idempotency_key,
        row.first_attempt_at || dispatchTime,
        this.now(),
      )
      confirmedID = id
      await this.recordAcceptance(row, id)
    } catch (error) {
      if (confirmedID) {
        await this.recordAcceptance(row, confirmedID)
        return true
      }
      const uncertain =
        !!row.uncertain_since ||
        (dispatched && !(error instanceof EmailProviderError && error.kind === 'rejected')) ||
        (error instanceof EmailProviderError && ['uncertain', 'reconcile'].includes(error.kind))
      const first = row.first_attempt_at || timestamp
      const frozen =
        uncertain &&
        (!withinEmailRetryWindow(first, this.now()) ||
          row.attempts + (dispatched ? 1 : 0) >= 5 ||
          error instanceof SiteAccessError ||
          !(error instanceof EmailProviderError) ||
          ['unconfigured', 'rejected', 'reconcile'].includes(error.kind))
      const next = frozen
        ? '9999-12-31T23:59:59.999Z'
        : new Date(
            this.now() + Math.min(3600000, 1000 * 2 ** Math.min(row.attempts + 1, 12)),
          ).toISOString()
      const message =
        error instanceof EmailProviderError
          ? error.message
          : error instanceof SiteAccessError
            ? 'Access changed. Review the delivery before retrying.'
            : 'Recorded content or recipient settings changed. Review before retrying.'
      await this.db.batch([
        this.db
          .prepare(
            "UPDATE vc_crm_email_outbox SET status=?,uncertain_since=CASE WHEN ?=1 THEN COALESCE(uncertain_since,?) ELSE uncertain_since END,error=?,next_attempt_at=?,lease_until=NULL,revision=revision+1,updated_at=? WHERE id=? AND fence=? AND status='sending' AND provider_id IS NULL",
          )
          .bind(
            uncertain ? 'uncertain' : 'failed',
            uncertain ? 1 : 0,
            timestamp,
            message,
            next,
            new Date(this.now()).toISOString(),
            row.id,
            row.fence,
          ),
        this.db
          .prepare(
            'INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,actor_id,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1',
          )
          .bind(
            crypto.randomUUID(),
            row.id,
            row.fence,
            uncertain ? 'uncertain' : 'failed',
            row.actor_id,
            message,
            new Date(this.now()).toISOString(),
          ),
      ])
    }
    return true
  }
  private async recordAcceptance(row: EmailOutboxRow, id: string) {
    // Record the external fact even if authorization changed while the request was in flight.
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE vc_crm_email_outbox SET provider_id=?,status='accepted',next_reconcile_at=?,lease_until=NULL,error=NULL,revision=revision+1,updated_at=? WHERE id=? AND payload_hash=? AND provider_id IS NULL",
        )
        .bind(
          id,
          new Date(this.now() + 60000).toISOString(),
          new Date(this.now()).toISOString(),
          row.id,
          row.payload_hash,
        ),
      this.db
        .prepare(
          "INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,provider_id,actor_id,created_at) SELECT ?,?,?,'accepted',?,?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          row.id,
          row.fence,
          id,
          row.actor_id,
          new Date(this.now()).toISOString(),
        ),
    ])
  }
}
