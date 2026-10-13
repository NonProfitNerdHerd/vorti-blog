import type { Answers, FormDefinition } from './model'

/** Explicit supported currencies; adapters may extend this registry with tested minor-unit rules. */
export const paymentCurrencies: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2, JPY: 0, KRW: 0 }
export interface PaymentQuote { provider: 'stripe' | 'simulator'; amount: number; currency: string }
export interface PaymentView extends PaymentQuote {
  status: 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded'; simulated: boolean; configured: boolean
  refundedAmount: number; title: string; message?: string; checkoutURL?: string; confirmation?: string; continueURL?: string
}
/** Call only with server-evaluated answers. Monetary storage uses integer minor units. */
export function paymentQuote(definition: FormDefinition, answers: Answers): PaymentQuote | undefined {
  if (!definition.payment) return undefined
  const { provider, amountField, currency } = definition.payment
  const digits = paymentCurrencies[currency], value = answers[amountField]
  if (!['stripe', 'simulator'].includes(provider) || digits === undefined || typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Configure a supported currency and a valid calculated payment amount.')
  const amount = Math.round((value + Number.EPSILON) * 10 ** digits)
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 99999999) throw new Error('The calculated payment amount must be positive and within the configured 99,999,999 minor-unit limit.')
  return { provider, amount, currency }
}
