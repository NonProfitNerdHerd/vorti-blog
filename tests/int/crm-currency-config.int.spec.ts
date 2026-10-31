import { describe, expect, it } from 'vitest'
import { assertConfiguredCurrency, currencyExponent, validateCurrencyConfig } from '../../src/crm/currency-config'

describe('VortiCause currency configuration', () => {
  it('uses standard minor units and allows only configured currencies', () => {
    const config = validateCurrencyConfig({ allowedCurrencies: ['USD', 'JPY'], defaultCurrency: 'USD' })
    expect(currencyExponent('USD')).toBe(2)
    expect(currencyExponent('JPY')).toBe(0)
    expect(() => assertConfiguredCurrency(config, 'USD', 0)).toThrow('standard precision')
    expect(() => assertConfiguredCurrency(config, 'EUR', 2)).toThrow('allowed currency')
    expect(() => assertConfiguredCurrency(config, 'JPY', 0)).not.toThrow()
  })
})
