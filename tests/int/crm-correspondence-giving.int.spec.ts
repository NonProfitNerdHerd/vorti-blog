import { expect, it } from 'vitest'
import {
  documentAmount,
  statementGiving,
  type StatementGift,
} from '../../src/crm/correspondence-giving'
const gift: StatementGift = {
  id: 'cash',
  received_on: '2026-10-24',
  currency: 'USD',
  exponent: 2,
  original_minor: '10000',
  net_minor: '7500',
  kind: 'check',
  state: 'posted',
  revision: 2,
}
it('separates currencies and explicitly excludes voids and donor-valued in-kind estimates', () => {
  const result = statementGiving([
    gift,
    { ...gift, id: 'eur', currency: 'EUR', net_minor: '9000' },
    {
      ...gift,
      id: 'goods',
      kind: 'in-kind',
      original_minor: '999999999999',
      net_minor: '999999999999',
    },
    { ...gift, id: 'void', state: 'void' },
  ])
  expect(result.totals).toEqual([
    { currency: 'EUR', minorUnits: '9000', exponent: 2 },
    { currency: 'USD', minorUnits: '7500', exponent: 2 },
  ])
  expect(result.text).toContain('current net USD 75.00')
  expect(result.text).toContain('In-kind contribution; no cash amount included.')
  expect(result.text).not.toContain('9999999999.99')
  expect(result.text).toContain('Voided; excluded')
  expect(result.gifts[0]).not.toBe(gift)
})
it('formats exact minor units and rejects duplicates and inconsistent financial inputs', () => {
  expect(documentAmount('900719925474099321', 'USD', 2)).toBe('USD 9007199254740993.21')
  expect(documentAmount('1', 'KWD', 3)).toBe('KWD 0.001')
  expect(() => statementGiving([gift, gift])).toThrow('once')
  expect(() => statementGiving([{ ...gift, net_minor: '-1' }])).toThrow()
  expect(() => statementGiving([gift, { ...gift, id: 'precision', exponent: 3 }])).toThrow(
    'precision',
  )
  expect(statementGiving([]).text).toContain('No received cash')
})
