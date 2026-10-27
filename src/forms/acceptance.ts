import { publicWebsite } from '../organizations/public-website'
import type { Answers, FormAction, FormField, PaymentQuote } from '@design-system/payload-design-core/forms'
import { FormHTTPError } from './security'
import { tenantAuthorityActive, featureAvailableAt } from '../organizations/tenant-runtime'

export interface Acceptance {
  formID: number | string
  site: string
  revision: string
  key: string
  sessionHash: string
  answers: Answers
  snapshot: { title: string; fields: FormField[]; confirmation?: string; redirect?: string }
  actions: FormAction[]
  payment: boolean
  paymentDetails?: PaymentQuote
  attachments: { id: string; fieldID: string }[]
  bookings?: { tokenHash: string; resource: string; startsAt: string }[]
  analytics?: boolean
  hostFeature?: 'pages' | 'posts' | 'wiki' | 'intranet'
}

/** Stable comparison also accepts retries whose JSON object properties arrive in a different order. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonicalJSON(v)}`).join(',')}}`
  return JSON.stringify(value)
}

/** D1 batch runs in one transaction: acceptance, attachment claims and jobs succeed together. */
export async function acceptSubmission(db: D1Database, input: Acceptance, now = new Date().toISOString()): Promise<{ created: boolean; id: string }> {
  const { site, revision, key, sessionHash } = input
  const active = await tenantAuthorityActive(db, site)
  const authority = active ? await db.prepare('SELECT o.id,o.authority_revision FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id WHERE s.id=?').bind(site).first<{id:string;authority_revision:number}>() : null
  if (active && (!authority || !(await featureAvailableAt(db, site, 'forms')))) throw new FormHTTPError('This form is unavailable.',404)
  if (input.hostFeature && !await featureAvailableAt(db, site, input.hostFeature)) throw new FormHTTPError('This form placement is unavailable.',404)
  if (input.payment && !input.paymentDetails) throw new FormHTTPError('A server-calculated payment quote is required.')
  const bookings = input.bookings || []
  if (new Set(bookings.map(hold => hold.tokenHash)).size !== bookings.length) throw new FormHTTPError('Each booking field needs its own reservation.')
  if (new Set(input.attachments.map(file => file.id)).size !== input.attachments.length) throw new FormHTTPError('An attachment can only be used once in a submission.')
  const answers = canonicalJSON(input.answers)
  const existing = await db.prepare('SELECT id, answers FROM form_submissions WHERE idempotency_key=? AND site=?').bind(key, site).first<{ id: number; answers: string }>()
  if (existing) {
    if (canonicalJSON(JSON.parse(existing.answers)) !== answers) throw new FormHTTPError('This retry key belongs to different answers.', 409)
    return { created: false, id: String(existing.id) }
  }
  // Recheck ownership inside the transaction, not only in application reads before acceptance.
  const validFiles = input.attachments.map(() => `EXISTS (SELECT 1 FROM form_attachments WHERE id=? AND field_i_d=? AND site=? AND revision=? AND session_hash=? AND submission_i_d IS NULL AND expires_at>? AND scan_status IN ('unscanned','clean'))`)
  const validHolds = bookings.map(() => `EXISTS (SELECT 1 FROM form_booking_holds h JOIN form_booking_slots s ON h.slot_id=s.id JOIN form_resources r ON CAST(r.id AS TEXT)=s.resource AND r.site=s.site WHERE h.token_hash=? AND h.site=? AND h.session_hash=? AND h.status='held' AND h.expires_ms>? AND s.resource=? AND s.starts_at=? AND EXISTS (SELECT 1 FROM json_each(r.availability) a WHERE json_extract(a.value,'$.id')=s.id))`)
  const websiteRequired = site !== 'default' || active
  const website = websiteRequired ? await publicWebsite(db,site) : null
  if (websiteRequired && !website) throw new FormHTTPError('This website is paused. Your answers have not been cleared.',404)
  const websiteGuards = website ? [`EXISTS(SELECT 1 FROM vc_organizations WHERE id=? AND authority_revision=?)`] : []
  const guards = [...validFiles, ...validHolds, ...websiteGuards, ...(authority ? ['EXISTS(SELECT 1 FROM vc_organizations WHERE id=? AND authority_revision=?)'] : [])]
  const insert = db.prepare(`INSERT OR IGNORE INTO form_submissions (form_id, site, revision, idempotency_key, answers, schema_snapshot, workflow_status, payment_status, session_hash, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?${guards.length ? ` WHERE ${guards.join(' AND ')}` : ''}`).bind(
    input.formID, site, revision, key, answers, JSON.stringify(input.snapshot), input.payment ? 'pending' : 'none', sessionHash, now, now,
    ...input.attachments.flatMap(file => [file.id, file.fieldID, site, revision, sessionHash, now]),
    ...bookings.flatMap(hold => [hold.tokenHash, site, sessionHash, Date.parse(now), hold.resource, hold.startsAt]),
    ...(website ? [website.organization_id,website.authority_revision] : []),
    ...(authority ? [authority.id,authority.authority_revision] : []),
  )
  // Concurrent retries with different answers must not add jobs or claim files for the winner.
  const winner = 'SELECT id FROM form_submissions WHERE idempotency_key=? AND site=? AND answers=?'
  const jobs = input.actions.map(action => db.prepare(`INSERT OR IGNORE INTO form_outbox (label, site, event_i_d, submission_i_d, revision, kind, status, payload, attempts, next_attempt_at, created_at, updated_at) SELECT ?, ?, ?, CAST(id AS TEXT), ?, ?, ?, ?, 0, ?, ?, ? FROM form_submissions WHERE id IN (${winner})`).bind(
    action.name, site, `${key}:${action.id}`, revision, action.kind, action.requiresPayment ? 'waiting-payment' : 'pending', JSON.stringify({ action, hostFeature: input.hostFeature }), now, now, now, key, site, answers,
  ))
  const attachments = input.attachments.map(file => db.prepare(`UPDATE form_attachments SET submission_i_d=CAST((${winner}) AS TEXT), expires_at=NULL WHERE id=? AND site=? AND session_hash=? AND submission_i_d IS NULL AND EXISTS (${winner})`).bind(key, site, answers, file.id, site, sessionHash, key, site, answers))
  const confirmations = bookings.map(hold => db.prepare(`UPDATE form_booking_holds SET status='confirmed', submission_key=? WHERE token_hash=? AND site=? AND session_hash=? AND status='held' AND EXISTS (${winner})`).bind(key, hold.tokenHash, site, sessionHash, key, site, answers))
  const analytics = input.analytics ? [db.prepare(`INSERT OR IGNORE INTO form_analytics (label, site, form_i_d, revision, event_i_d, session_hash, kind, duration_ms, created_at, updated_at) SELECT 'accepted', ?, ?, ?, ?, ?, 'accepted', (SELECT MAX(0, (julianday(?) - julianday(MIN(created_at))) * 86400000) FROM form_analytics WHERE site=? AND revision=? AND session_hash=? AND kind='start'), ?, ? FROM form_submissions WHERE id IN (${winner})`).bind(site, String(input.formID), revision, `accepted:${key}`, sessionHash, now, site, revision, sessionHash, now, now, key, site, answers)] : []
  const payment = input.paymentDetails ? [db.prepare(`INSERT OR IGNORE INTO form_payment_sessions(submission_key,site,submission_id,revision,provider,amount,currency,created_at,updated_at) SELECT ?,?,id,?,?,?,?,?,? FROM form_submissions WHERE id IN (${winner})`).bind(key, site, revision, input.paymentDetails.provider, input.paymentDetails.amount, input.paymentDetails.currency, now, now, key, site, answers)] : []
  const result = await db.batch([insert, ...payment, ...jobs, ...attachments, ...confirmations, ...analytics])
  const saved = await db.prepare('SELECT id, answers FROM form_submissions WHERE idempotency_key=? AND site=?').bind(key, site).first<{ id: number; answers: string }>()
  if (!saved) throw new FormHTTPError('An attachment or reservation expired, belongs to another session, or was already submitted. Upload the file or reserve an available time again.', 409)
  if (canonicalJSON(JSON.parse(saved.answers)) !== answers) throw new FormHTTPError('This retry key belongs to different answers.', 409)
  // D1 includes rows written by transactional automation triggers in meta.changes.
  // An ignored acceptance fires no AFTER INSERT triggers and still reports zero.
  return { created: result[0].meta.changes > 0, id: String(saved.id) }
}
