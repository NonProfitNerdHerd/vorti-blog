import type { Endpoint, PayloadRequest } from 'payload'
import type { PaymentView } from '@design-system/payload-design-core/forms'
import { canForm, FORM_SITE, type FormsUser } from './access'
import type { FormPlatform } from './platform'
import { FormHTTPError, hashToken, readBoundedJSON } from './security'
import { applyPaymentEvent, paymentToken, verifyPaymentToken, type PaymentRow } from './payment-store'
import { stripeTestProvider, verifyStripeEvent } from './payments'
import { FormOutbox } from './outbox'
import { createActionHandlers } from './action-runtime'

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
const configured = (row: PaymentRow, platform: FormPlatform) => row.provider === 'simulator' ? platform.local === true : stripeTestProvider().configured && !!process.env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith('whsec_')
export async function paymentView(db: D1Database, row: PaymentRow, platform: FormPlatform): Promise<PaymentView> {
  const entry = await db.prepare('SELECT schema_snapshot FROM form_submissions WHERE id=? AND site=?').bind(row.submission_id, row.site).first<{ schema_snapshot: string }>()
  const snapshot = entry ? JSON.parse(entry.schema_snapshot) as { title?: string; confirmation?: string; redirect?: string } : {}
  const title = String(snapshot.title || 'Form payment')
  let continueURL: string | undefined
  if (row.state === 'paid' && typeof snapshot.redirect === 'string') {
    try {
      const url = new URL(snapshot.redirect, 'https://form.local')
      if (url.origin === 'https://form.local' && snapshot.redirect.startsWith('/') && !snapshot.redirect.startsWith('//')) continueURL = url.pathname + url.search + url.hash
    } catch { /* Invalid historic redirects are omitted. */ }
  }
  return { title, provider: row.provider, amount: row.amount, currency: row.currency, status: row.state, refundedAmount: row.refunded_amount,
    simulated: row.provider === 'simulator', configured: configured(row, platform),
    ...(row.state === 'paid' ? { continueURL, confirmation: snapshot.confirmation } : {}),
    ...(!configured(row, platform) ? { message: row.provider === 'simulator' ? 'The local simulator is unavailable outside development.' : 'Stripe test mode is not configured. Your response is saved; payment-dependent actions are waiting.' } : {}),
  }
}
function runActions(platform: FormPlatform, req: PayloadRequest, site: string) {
  platform.defer?.(async () => { try { await new FormOutbox(platform.db, createActionHandlers(platform, req.payload), undefined, platform.local).run(site, 5) } catch { req.payload.logger.error({ msg: 'Payment actions remain queued for retry.' }) } })
}
async function stripeBody(req: PayloadRequest): Promise<string> {
  if (Number(req.headers.get('content-length')) > 256000) throw new FormHTTPError('Payment event is too large.', 413)
  const reader = req.body?.getReader()
  if (!reader) throw new FormHTTPError('A payment event body is required.')
  const chunks: Uint8Array[] = []; let size = 0
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 256000) { await reader.cancel(); throw new FormHTTPError('Payment event is too large.', 413) }; chunks.push(part.value) }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}
export function formPaymentEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-payments/entry/:id', method: 'get', handler: async req => {
    const site = platform.resolveSite?.(req) || FORM_SITE
    if (!canForm(req.user as FormsUser, 'entries', site)) return Response.json({ message: 'Entry access is required.' }, { status: 403, headers })
    const row = await platform.db.prepare('SELECT * FROM form_payment_sessions WHERE submission_id=? AND site=?').bind(String(req.routeParams?.id || ''), site).first<PaymentRow>()
    if (!row) return Response.json({ payment: null }, { headers })
    return Response.json({ payment: { ...await paymentView(platform.db, row, platform), reference: row.checkout_ref, updatedAt: row.updated_at } }, { headers })
  } }, { path: '/forms-payments/config', method: 'get', handler: async req => {
    const site = platform.resolveSite?.(req) || FORM_SITE
    if (!canForm(req.user as FormsUser, 'edit', site)) return Response.json({ message: 'Form editing access is required.' }, { status: 403, headers })
    return Response.json({ stripe: stripeTestProvider().configured && !!process.env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith('whsec_'), simulator: platform.local === true }, { headers })
  } }, { path: '/forms-payments/:key', method: 'post', handler: async req => {
    try {
      if (req.headers.get('origin') !== new URL(req.url!).origin) throw new FormHTTPError('A same-origin payment request is required.', 403)
      const body = await readBoundedJSON(req, 4000), key = String(req.routeParams?.key || '')
      const site = platform.resolveSite?.(req) || FORM_SITE
      let row = await platform.db.prepare('SELECT * FROM form_payment_sessions WHERE submission_key=? AND site=?').bind(key, site).first<PaymentRow>()
      if (!row) throw new FormHTTPError('Payment not found.', 404)
      await verifyPaymentToken(req.payload.secret, row, req.headers.get('x-form-payment') || '')
      if (!['status', 'checkout', 'simulate'].includes(String(body.operation))) throw new FormHTTPError('Choose a valid payment operation.')
      if (body.operation !== 'status' && !configured(row, platform)) return Response.json(await paymentView(platform.db, row, platform), { status: 503, headers })
      if (body.operation === 'checkout') {
        if (row.provider !== 'stripe') throw new FormHTTPError('Use the clearly labeled local simulator controls.')
        if (['paid', 'refunded', 'canceled'].includes(row.state)) throw new FormHTTPError('This payment cannot start another checkout.', 409)
        if (!row.checkout_ref) {
          const form = await platform.db.prepare('SELECT slug FROM forms WHERE id=(SELECT form_id FROM form_submissions WHERE id=? AND site=?)').bind(row.submission_id, site).first<{ slug: string }>()
          if (!form) throw new FormHTTPError('This payment form is unavailable.', 410)
          const view = await paymentView(platform.db, row, platform), token = await paymentToken(req.payload.secret, row)
          const checkout = await stripeTestProvider().checkout({ amount: row.amount, currency: row.currency, submissionKey: key, title: view.title, returnURL: `${new URL(req.url!).origin}/forms/${encodeURIComponent(form.slug)}#payment=${token}` })
          await platform.db.prepare('UPDATE form_payment_sessions SET checkout_ref=?,checkout_url=?,updated_at=? WHERE submission_key=? AND site=? AND checkout_ref IS NULL').bind(checkout.reference, checkout.url, new Date().toISOString(), key, site).run()
        }
        row = (await platform.db.prepare('SELECT * FROM form_payment_sessions WHERE submission_key=? AND site=?').bind(key, site).first<PaymentRow>())!
        return Response.json({ ...await paymentView(platform.db, row, platform), checkoutURL: row.checkout_url }, { headers })
      }
      if (body.operation === 'simulate') {
        if (!platform.local || row.provider !== 'simulator') throw new FormHTTPError('Simulation is available only for local simulator payments.', 403)
        if (!['paid', 'failed', 'canceled', 'refunded'].includes(String(body.status))) throw new FormHTTPError('Choose a simulator result.')
        if (body.status === 'refunded' && row.state !== 'paid' && row.state !== 'refunded') throw new FormHTTPError('Simulate a successful payment before refunding it.', 409)
        if (typeof body.eventID !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.eventID)) throw new FormHTTPError('A simulator event ID is required.')
        await applyPaymentEvent(platform.db, row, { id: `${key}:${body.eventID}`, status: body.status as PaymentRow['state'], amount: row.amount, currency: row.currency, refundedAmount: body.status === 'refunded' ? row.amount : row.refunded_amount, created: Math.floor(Date.now() / 1000) })
        runActions(platform, req, site)
      }
      // Recover delayed/missed webhooks by reading the stored session, never client-provided status.
      // Claim a short cooldown atomically so repeated refresh clicks do not flood the provider.
      if (body.operation === 'status' && row.provider === 'stripe' && row.checkout_ref && configured(row, platform) && row.state !== 'refunded') {
        const now = new Date().toISOString(), before = new Date(Date.now() - 30000).toISOString()
        const claim = await platform.db.prepare('UPDATE form_payment_sessions SET updated_at=? WHERE submission_key=? AND site=? AND updated_at<?').bind(now, key, site, before).run()
        if (claim.meta.changes === 1) {
          const state = await stripeTestProvider().read(row.checkout_ref)
          if (state.submissionKey !== key) throw new FormHTTPError('Payment state does not match this checkout.')
          const id = `refresh:${key}:${await hashToken(JSON.stringify(state))}`
          await applyPaymentEvent(platform.db, row, { ...state, id, created: Math.floor(Date.now() / 1000) })
          runActions(platform, req, site)
        }
      }
      row = (await platform.db.prepare('SELECT * FROM form_payment_sessions WHERE submission_key=? AND site=?').bind(key, site).first<PaymentRow>())!
      return Response.json(await paymentView(platform.db, row, platform), { headers })
    } catch (error) { return Response.json({ message: error instanceof FormHTTPError ? error.message : 'Payment service is unavailable. Your response remains saved; retry safely.' }, { status: error instanceof FormHTTPError ? error.status : 502, headers }) }
  } }, { path: '/forms-payment-webhook', method: 'post', handler: async req => {
    const secret = process.env.STRIPE_TEST_WEBHOOK_SECRET
    if (!secret?.startsWith('whsec_') || !stripeTestProvider().configured) return Response.json({ message: 'Stripe test mode is not configured.' }, { status: 503, headers })
    let event
    try { event = await verifyStripeEvent(await stripeBody(req), req.headers.get('stripe-signature') || '', secret) }
    catch { return Response.json({ message: 'Invalid Stripe test event.' }, { status: 400, headers }) }
    if (!event) return Response.json({ received: true }, { headers })
    try {
      const row = await platform.db.prepare("SELECT * FROM form_payment_sessions WHERE provider='stripe' AND (submission_key=? OR checkout_ref=? OR intent_ref=?) LIMIT 1").bind(event.submissionKey || '', event.reference, event.intent || '').first<PaymentRow>()
      if (!row || !row.checkout_ref) return Response.json({ received: true }, { headers })
      // Read the exact stored Checkout session from Stripe; metadata alone never proves payment.
      const state = await stripeTestProvider().read(row.checkout_ref)
      if (state.submissionKey !== row.submission_key || (event.intent && event.intent !== state.intent) || (event.reference.startsWith('cs_') && event.reference !== row.checkout_ref)) throw new FormHTTPError('Payment event belongs to a different checkout.')
      await applyPaymentEvent(platform.db, row, { ...state, id: event.id, created: event.created })
      runActions(platform, req, row.site)
      return Response.json({ received: true }, { headers })
    } catch (error) { return Response.json({ message: error instanceof FormHTTPError ? 'Payment event did not match its checkout.' : 'Payment reconciliation is temporarily unavailable; retry this event.' }, { status: error instanceof FormHTTPError ? 400 : 503, headers }) }
  } }]
}
