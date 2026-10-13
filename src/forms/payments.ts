import { constantEqual, hmac } from './security'
import { paymentSessionSQL } from './payment-store'
import type { PaymentUpdate } from './payment-store'

export type PaymentState = 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded'
export interface PaymentCheckout { amount: number; currency: string; submissionKey: string; title: string; returnURL: string }
export interface PaymentProvider { kind: string; configured: boolean; checkout: (input: PaymentCheckout) => Promise<{ reference: string; url: string }>; read: (reference: string) => Promise<Omit<PaymentUpdate, 'id' | 'created'> & { submissionKey: string }> }
/** Test credentials only. Card details never pass through our application. */
export function stripeTestProvider(secret = process.env.STRIPE_TEST_SECRET_KEY): PaymentProvider {
  async function request(path: string, options?: RequestInit) {
    if (!secret?.startsWith('sk_test_')) throw new Error('Stripe test mode is not configured. Set STRIPE_TEST_SECRET_KEY with a test key.')
    const response = await fetch(`https://api.stripe.com/v1/${path}`, { ...options, headers: { Authorization: `Bearer ${secret}`, ...options?.headers }, signal: AbortSignal.timeout(10000), redirect: 'error' })
    if (!response.ok) throw new Error(`Stripe test request returned HTTP ${response.status}.`)
    return response
  }
  return { kind: 'stripe', configured: !!secret?.startsWith('sk_test_'), checkout: async input => {
    if (!secret?.startsWith('sk_test_')) throw new Error('Stripe test mode is not configured. Set STRIPE_TEST_SECRET_KEY with a test key.')
    if (!Number.isSafeInteger(input.amount) || input.amount < 1) throw new Error('Payment amount must be positive integer minor units.')
    const body = new URLSearchParams({ mode: 'payment', 'payment_method_types[0]': 'card', 'line_items[0][price_data][currency]': input.currency.toLowerCase(), 'line_items[0][price_data][unit_amount]': String(input.amount), 'line_items[0][price_data][product_data][name]': input.title, 'line_items[0][quantity]': '1', 'metadata[submissionKey]': input.submissionKey, 'payment_intent_data[metadata][submissionKey]': input.submissionKey, success_url: input.returnURL, cancel_url: input.returnURL })
    const response = await request('checkout/sessions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `forms:${input.submissionKey}` }, body })
    const result = await response.json() as { id: string; url: string; livemode: boolean }
    if (result.livemode !== false || !/^cs_test_[a-zA-Z0-9]+$/.test(result.id) || !result.url?.startsWith('https://checkout.stripe.com/')) throw new Error('Unexpected Stripe checkout response.')
    return { reference: result.id, url: result.url }
  }, read: async reference => {
    if (!/^cs_test_[a-zA-Z0-9]+$/.test(reference)) throw new Error('Invalid Stripe test checkout reference.')
    const response = await request(`checkout/sessions/${reference}?expand[]=payment_intent.latest_charge`)
    const value = await response.json() as { id: string; livemode: boolean; status: string; payment_status: string; amount_total: number; currency: string; metadata?: { submissionKey?: string }; payment_intent?: { id: string; status: string; latest_charge?: { amount: number; amount_refunded: number; refunded: boolean } } }
    if (value.livemode !== false || value.id !== reference || (value.payment_intent != null && typeof value.payment_intent !== 'object') || (value.payment_intent?.latest_charge != null && typeof value.payment_intent.latest_charge !== 'object') || !value.metadata?.submissionKey) throw new Error('Unexpected Stripe test payment state.')
    const intent = value.payment_intent, charge = intent?.latest_charge
    const refundedAmount = charge?.amount_refunded || 0
    const status: PaymentState = charge?.refunded ? 'refunded' : value.payment_status === 'paid' || intent?.status === 'succeeded' ? 'paid' : value.status === 'expired' || intent?.status === 'canceled' ? 'canceled' : intent?.status === 'requires_payment_method' ? 'failed' : 'pending'
    return { status, amount: value.amount_total, currency: value.currency, refundedAmount, intent: intent?.id, submissionKey: value.metadata.submissionKey }
  } }
}
export interface VerifiedPaymentEvent { id: string; reference: string; submissionKey?: string; status: PaymentState; amount?: number; currency?: string; intent?: string; created: number }
export async function verifyStripeEvent(raw: string, header: string, secret: string, now = Date.now()): Promise<VerifiedPaymentEvent | null> {
  const fields = header.split(',').map(item => item.trim().split('=')), timestamp = fields.find(([key]) => key === 't')?.[1]
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new Error('Expired or invalid payment event timestamp.')
  const signature = await hmac(secret, `${timestamp}.${raw}`)
  if (!fields.filter(([key]) => key === 'v1').some(([, value]) => constantEqual(value, signature))) throw new Error('Invalid payment webhook signature.')
  const event = JSON.parse(raw) as { id: string; type: string; livemode: boolean; created: number; data: { object: { id: string; metadata?: { submissionKey?: string }; payment_intent?: string; payment_status?: string; amount?: number; amount_total?: number; currency?: string } } }
  if (!/^evt_[a-zA-Z0-9_]+$/.test(event.id || '') || event.livemode !== false || !Number.isSafeInteger(event.created) || event.created < 0 || !event.data?.object?.id) throw new Error('Only valid Stripe test-mode events are accepted.')
  const object = event.data.object
  const statuses: Record<string, PaymentState> = { 'payment_intent.succeeded': 'paid', 'payment_intent.payment_failed': 'failed', 'payment_intent.canceled': 'canceled', 'checkout.session.expired': 'canceled', 'charge.refunded': 'refunded' }
  const status = event.type === 'checkout.session.completed' ? object.payment_status === 'paid' ? 'paid' : 'pending' : statuses[event.type]
  if (!status) return null
  if (event.type.startsWith('checkout.') ? !/^cs_test_[a-zA-Z0-9]+$/.test(object.id) : event.type.startsWith('payment_intent.') ? !/^pi_[a-zA-Z0-9]+$/.test(object.id) : !/^ch_[a-zA-Z0-9]+$/.test(object.id) || !/^pi_[a-zA-Z0-9]+$/.test(object.payment_intent || '')) throw new Error('Invalid payment object reference.')
  return { id: event.id, reference: object.id, submissionKey: object.metadata?.submissionKey, status, amount: object.amount_total ?? object.amount, currency: object.currency, intent: event.type.startsWith('payment_intent.') ? object.id : object.payment_intent, created: event.created }
}
export const paymentSQL = [
  'CREATE TABLE IF NOT EXISTS form_payment_events (id text PRIMARY KEY NOT NULL, submission_key text NOT NULL, status text NOT NULL, received_at text NOT NULL)',
  ...paymentSessionSQL,
]
