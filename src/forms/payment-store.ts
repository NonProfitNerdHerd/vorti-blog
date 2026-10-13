import type { PaymentQuote } from '@design-system/payload-design-core/forms'
import { FormHTTPError, constantEqual, hmac } from './security'

export interface PaymentRow {
  submission_key: string; site: string; submission_id: number; revision: string; provider: PaymentQuote['provider']; amount: number; currency: string
  state: 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded'; checkout_ref: string | null; checkout_url: string | null; intent_ref: string | null
  refunded_amount: number; event_created: number; created_at: string; updated_at: string
}
export interface PaymentUpdate { id: string; status: PaymentRow['state']; amount: number; currency: string; refundedAmount: number; created: number; intent?: string }
export async function paymentToken(secret: string, row: Pick<PaymentRow, 'submission_key' | 'site' | 'created_at'>): Promise<string> {
  const expires = String(Date.parse(row.created_at) + 30 * 86400000)
  return `${row.submission_key}.${expires}.${await hmac(secret, `payment:${row.site}:${row.submission_key}:${expires}`)}`
}
export async function verifyPaymentToken(secret: string, row: PaymentRow, token: string): Promise<void> {
  const [key, expiry] = token.split('.')
  if (key !== row.submission_key || !Number.isSafeInteger(Number(expiry)) || Number(expiry) <= Date.now() || !constantEqual(token, await paymentToken(secret, row))) throw new FormHTTPError('This private payment link is invalid or expired.', 403)
}
/** Durable, monotonic reconciliation and release of queued actions share one D1 transaction. */
export async function applyPaymentEvent(db: D1Database, row: PaymentRow, event: PaymentUpdate): Promise<boolean> {
  if (!['pending', 'paid', 'failed', 'canceled', 'refunded'].includes(event.status) || typeof event.currency !== 'string' || typeof event.id !== 'string') throw new FormHTTPError('Invalid payment event.')
  if (!event.id || event.id.length > 200 || !Number.isSafeInteger(event.amount) || event.amount !== row.amount || event.currency.toUpperCase() !== row.currency || !Number.isSafeInteger(event.refundedAmount) || event.refundedAmount < 0 || event.refundedAmount > row.amount || !Number.isSafeInteger(event.created) || event.created < 0 || (event.status === 'refunded' && event.refundedAmount !== row.amount)) throw new FormHTTPError('Payment event does not match the accepted amount and currency.')
  if (row.intent_ref && event.intent && row.intent_ref !== event.intent) throw new FormHTTPError('Payment event belongs to a different checkout.')
  const id = `${row.provider}:${event.id}`, now = new Date().toISOString()
  const result = await db.batch([
    db.prepare(`UPDATE form_payment_sessions SET state=CASE WHEN state='refunded' OR ?='refunded' THEN 'refunded' WHEN state='paid' OR ?='paid' THEN 'paid' WHEN ?>=event_created THEN ? ELSE state END, refunded_amount=MAX(refunded_amount,?), intent_ref=COALESCE(intent_ref,?), event_created=MAX(event_created,?), updated_at=? WHERE submission_key=? AND site=? AND NOT EXISTS(SELECT 1 FROM form_payment_events WHERE id=?)`).bind(event.status, event.status, event.created, event.status, event.refundedAmount, event.intent || null, event.created, now, row.submission_key, row.site, id),
    db.prepare('INSERT OR IGNORE INTO form_payment_events(id,submission_key,status,received_at) VALUES(?,?,?,?)').bind(id, row.submission_key, event.status, now),
    db.prepare(`UPDATE form_submissions SET payment_status=(SELECT CASE WHEN provider='simulator' AND state='paid' THEN 'simulated' ELSE state END FROM form_payment_sessions WHERE submission_key=?),payment_reference=(SELECT checkout_ref FROM form_payment_sessions WHERE submission_key=?),updated_at=? WHERE id=? AND site=?`).bind(row.submission_key, row.submission_key, now, row.submission_id, row.site),
    db.prepare(`UPDATE form_outbox SET status='pending',next_attempt_at=?,updated_at=? WHERE submission_i_d=? AND site=? AND status='waiting-payment' AND EXISTS(SELECT 1 FROM form_payment_sessions WHERE submission_key=? AND state='paid')`).bind(now, now, String(row.submission_id), row.site, row.submission_key),
    db.prepare(`UPDATE form_outbox SET status='waiting-payment',updated_at=? WHERE submission_i_d=? AND site=? AND json_extract(payload,'$.action.requiresPayment')=1 AND status IN ('pending','failed','unconfigured') AND EXISTS(SELECT 1 FROM form_payment_sessions WHERE submission_key=? AND state!='paid')`).bind(now, String(row.submission_id), row.site, row.submission_key),
  ])
  return result[1].meta.changes === 1
}

export const paymentSessionSQL = [
  `CREATE TABLE IF NOT EXISTS form_payment_sessions (submission_key text PRIMARY KEY NOT NULL, site text NOT NULL, submission_id integer NOT NULL, revision text NOT NULL, provider text NOT NULL, amount integer NOT NULL CHECK(amount>0), currency text NOT NULL, state text NOT NULL DEFAULT 'pending', checkout_ref text, checkout_url text, intent_ref text, refunded_amount integer NOT NULL DEFAULT 0, event_created integer NOT NULL DEFAULT 0, created_at text NOT NULL, updated_at text NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS form_payment_sessions_site_idx ON form_payment_sessions(site,submission_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS form_payment_sessions_checkout_idx ON form_payment_sessions(checkout_ref)',
  'CREATE INDEX IF NOT EXISTS form_payment_sessions_intent_idx ON form_payment_sessions(intent_ref)',
]
