import { describe, expect, it } from 'vitest'
import { emptyDefinition } from './model'
import { paymentQuote } from './payment'

describe('authoritative payment quote', () => {
  const definition = () => ({ ...emptyDefinition(), payment: { provider: 'stripe' as const, amountField: 'total', currency: 'USD' } })
  it('rounds decimal totals to integer minor units and handles zero-decimal currencies', () => {
    expect(paymentQuote(definition(), { total: 1.005 })).toMatchObject({ amount: 101, currency: 'USD' })
    expect(paymentQuote({ ...definition(), payment: { ...definition().payment, currency: 'JPY' } }, { total: 1200 })).toMatchObject({ amount: 1200 })
  })
  it('rejects missing, nonnumeric, nonpositive, excessive, and unsupported amounts', () => {
    for (const total of [undefined, '10', 0, -1, Number.NaN, Infinity, 1000000]) expect(() => paymentQuote(definition(), total === undefined ? {} : { total })).toThrow()
    expect(() => paymentQuote({ ...definition(), payment: { ...definition().payment, currency: 'XYZ' } }, { total: 10 })).toThrow()
    expect(paymentQuote(emptyDefinition(), {})).toBeUndefined()
  })
})
