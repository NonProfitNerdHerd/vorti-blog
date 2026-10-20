import { describe, expect, it } from 'vitest'
import {
  addMoney,
  parseMoney,
  receivedTotals,
  validateAllocations,
  type GiftLedgerRecord,
} from '../../src/crm/money'
const usd = { code: 'USD', exponent: 2 }
describe('CRM exact currency arithmetic', () => {
  it('preserves values beyond Number precision and rejects rounding', () => {
    expect(parseMoney('9007199254740993.21', usd).minorUnits).toBe('900719925474099321')
    expect(() => parseMoney('1.001', usd)).toThrow('precision')
    expect(parseMoney('10', { code: 'JPY', exponent: 0 }).minorUnits).toBe('10')
    expect(parseMoney('0.001', { code: 'KWD', exponent: 3 }).minorUnits).toBe('1')
    for (const amount of ['1e3', 'NaN', '1,000', ' 1', '+1', '01', 'Infinity'])
      expect(() => parseMoney(amount, usd)).toThrow()
  })
  it('keeps currencies separate and never adds floating point values', () => {
    expect(
      addMoney([
        parseMoney('0.1', usd),
        parseMoney('0.2', usd),
        { currency: 'EUR', minorUnits: '12' },
      ]),
    ).toEqual([
      { currency: 'EUR', minorUnits: '12' },
      { currency: 'USD', minorUnits: '30' },
    ])
  })
  it('requires balanced allocations without double-counting funds', () => {
    const gift = parseMoney('10.00', usd)
    const allocation = { ...gift, fund: 'general' }
    expect(() => validateAllocations(gift, [allocation])).not.toThrow()
    expect(() => validateAllocations(gift, [{ ...allocation, minorUnits: '999' }])).toThrow('equal')
    expect(() => validateAllocations(gift, [allocation, allocation])).toThrow('once')
    expect(() => validateAllocations(gift, [{ ...allocation, currency: 'EUR' }])).toThrow(
      'currency',
    )
  })
  it('counts actual net cash only and rejects duplicate gifts and over-refunds', () => {
    const gift: GiftLedgerRecord = {
      id: 'gift-1',
      received: parseMoney('100', usd),
      state: 'posted',
      kind: 'check',
      adjustments: [{ id: 'refund-1', reason: 'Partial refund', amount: parseMoney('-25', usd) }],
    }
    expect(
      receivedTotals([
        gift,
        { ...gift, id: 'gift-2', kind: 'in-kind' },
        { ...gift, id: 'gift-3', state: 'void' },
      ]),
    ).toEqual([parseMoney('75', usd)])
    expect(() => receivedTotals([gift, gift])).toThrow('Duplicate')
    expect(() =>
      receivedTotals([
        {
          ...gift,
          adjustments: [{ id: 'refund-2', reason: 'Refund', amount: parseMoney('-101', usd) }],
        },
      ]),
    ).toThrow('negative')
  })
})
