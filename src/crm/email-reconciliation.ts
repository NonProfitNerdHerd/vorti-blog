import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { CorrespondenceDocuments } from './correspondence-documents'
import { emailDigest, type EmailOutboxRow, type QueuedEmailPayload } from './email-outbox'
import { emailAddress } from './email-model'
import { ResendEmailProvider, type EmailRuntime } from './email-provider'
import { commitCRM, replayCRM } from './mutations'
const normalizedText = (text: string) => text.replace(/\r\n?/g, '\n')
const senderAddress = (value: string) =>
  emailAddress(
    value.endsWith('>') && value.includes('<')
      ? value.slice(value.lastIndexOf('<') + 1, -1)
      : value,
  )
const outcomes: Record<string, string> = {
  sent: 'accepted',
  queued: 'accepted',
  scheduled: 'accepted',
  delivery_delayed: 'accepted',
  delivered: 'delivered',
  opened: 'delivered',
  clicked: 'delivered',
  bounced: 'bounced',
  complained: 'complained',
  failed: 'failed',
  canceled: 'failed',
  suppressed: 'failed',
}
/** Reconciliation performs only provider reads and can never resend a message. */
export class EmailReconciler {
  private provider: ResendEmailProvider
  constructor(
    private db: D1Database,
    private actor: number,
    runtime: EmailRuntime,
    transport?: typeof fetch,
    private now: () => number = Date.now,
  ) {
    this.provider = new ResendEmailProvider(runtime, transport)
  }
  async reconcile(input: {
    site: string
    id: string
    providerID: string
    expectedRevision: number
    operationKey: string
  }) {
    const authority = new OrganizationRepository(this.db, this.actor),
      site = await authority.require(input.site, 'communications', 'edit')
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_email_outbox WHERE id=? AND site_id=?')
      .bind(input.id, input.site)
      .first<EmailOutboxRow>()
    if (!row) throw new SiteAccessError()
    const documents = new CorrespondenceDocuments(this.db, this.actor)
    await documents.get(input.site, row.document_id)
    const intent = {
      id: input.id,
      providerID: input.providerID,
      expectedRevision: input.expectedRevision,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'email.reconciled',
      type: 'email-delivery',
      intent,
    })
    if (replay) return replay
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision !== row.revision ||
      (row.provider_id && row.provider_id !== input.providerID)
    )
      throw new SiteConflictError()
    if (!row.first_attempt_at || (await emailDigest(row.payload)) !== row.payload_hash)
      throw new Error('Use a recorded dispatch attempt before reconciling a delivery.')
    const record = await this.provider.retrieve(input.providerID),
      payload = JSON.parse(row.payload) as QueuedEmailPayload,
      expected = payload.message
    const recordedTime = Date.parse(record.created_at),
      first = Date.parse(row.first_attempt_at)
    const mismatch = () => {
      throw new Error('Use the exact provider record matching this delivery reference and content.')
    }
    if (
      !Object.hasOwn(outcomes, record.last_event) ||
      !Number.isFinite(recordedTime) ||
      !Number.isFinite(first) ||
      recordedTime < first - 300000 ||
      recordedTime > this.now() + 300000 ||
      record.to.length !== 1 ||
      emailAddress(record.to[0]) !== expected.to[0] ||
      senderAddress(record.from) !== senderAddress(expected.from) ||
      record.subject !== expected.subject ||
      record.cc?.length ||
      record.bcc?.length ||
      !record.text ||
      !record.html ||
      normalizedText(record.text) !== normalizedText(expected.text) ||
      normalizedText(record.html) !== normalizedText(expected.html)
    )
      mismatch()
    const replies = record.reply_to || []
    if (
      replies.length !== (expected.reply_to ? 1 : 0) ||
      (expected.reply_to && emailAddress(replies[0]) !== expected.reply_to)
    )
      mismatch()
    await documents.get(input.site, row.document_id)
    let status = outcomes[record.last_event]
    if (row.status === 'complained') status = 'complained'
    else if (
      ['bounced', 'failed'].includes(row.status) &&
      row.provider_id &&
      ['accepted', 'delivered'].includes(status)
    )
      status = row.status
    else if (row.status === 'delivered' && status === 'accepted') status = 'delivered'
    const now = new Date(this.now()).toISOString(),
      guardKey = `${input.operationKey}:recipient`
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'email.reconciled',
      type: 'email-delivery',
      id: row.id,
      before: { status: row.status, providerID: row.provider_id },
      after: { status, providerID: record.id, event: record.last_event },
      intent,
      write: this.db
        .prepare(
          'UPDATE vc_crm_email_outbox SET provider_id=COALESCE(provider_id,?),status=?,last_provider_event=?,next_reconcile_at=?,fence=fence+1,lease_until=NULL,error=NULL,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
        )
        .bind(
          record.id,
          status,
          record.last_event,
          status === 'accepted' ? new Date(this.now() + 300000).toISOString() : null,
          now,
          row.id,
          input.site,
          input.expectedRevision,
        ),
      dependent: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id WHERE c.id=? AND c.archived=0 AND a.site_id=? AND a.archived=0',
          )
          .bind(guardKey, row.constituent_id, input.site),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guardKey),
        this.db
          .prepare(
            'INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,provider_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            row.id,
            row.fence + 1,
            `reconciled-${record.last_event}`,
            record.id,
            this.actor,
            now,
          ),
      ],
      result: { id: row.id, status },
    })
  }
}
/** Bounded status polling under the original actor; it never invokes the send endpoint. */
export async function reconcileNextEmail(
  db: D1Database,
  runtime: EmailRuntime,
  transport?: typeof fetch,
  now: () => number = Date.now,
): Promise<boolean> {
  if (!new ResendEmailProvider(runtime, transport).configured) return false
  const row = await db
    .prepare(
      "SELECT * FROM vc_crm_email_outbox WHERE status='accepted' AND provider_id IS NOT NULL AND (next_reconcile_at IS NULL OR next_reconcile_at<=?) ORDER BY COALESCE(next_reconcile_at,created_at),id LIMIT 1",
    )
    .bind(new Date(now()).toISOString())
    .first<EmailOutboxRow>()
  if (!row?.provider_id) return false
  try {
    await new EmailReconciler(db, row.actor_id, runtime, transport, now).reconcile({
      site: row.site_id,
      id: row.id,
      providerID: row.provider_id,
      expectedRevision: row.revision,
      operationKey: crypto.randomUUID(),
    })
  } catch {
    const timestamp = new Date(now()).toISOString()
    await db.batch([
      db
        .prepare(
          "UPDATE vc_crm_email_outbox SET next_reconcile_at=?,error='Provider status could not be verified. Review this delivery.',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='accepted'",
        )
        .bind(new Date(now() + 3600000).toISOString(), timestamp, row.id, row.revision),
      db
        .prepare(
          "INSERT INTO vc_crm_email_events(id,outbox_id,fence,event,actor_id,detail,created_at) SELECT ?,?,?,'reconciliation-deferred',?,'Provider status requires review.',? WHERE changes()=1",
        )
        .bind(crypto.randomUUID(), row.id, row.fence, row.actor_id, timestamp),
    ])
  }
  return true
}
