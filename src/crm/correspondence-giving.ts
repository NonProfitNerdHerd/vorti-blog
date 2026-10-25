import { assertMoney, type Money } from './money'

export interface StatementGift {
  id: string
  received_on: string
  currency: string
  exponent: number
  original_minor: string
  net_minor: string
  kind: 'cash' | 'check' | 'external-online' | 'in-kind'
  state: 'posted' | 'void'
  revision: number
}
export function documentAmount(minor: string, currency: string, exponent: number): string {
  assertMoney({ minorUnits: minor, currency })
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4)
    throw new Error('Choose a valid currency precision.')
  const negative = minor.startsWith('-'),
    digits = (negative ? minor.slice(1) : minor).padStart(exponent + 1, '0')
  return `${currency} ${negative ? '-' : ''}${exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits}`
}
/** Snapshot current retained ledger values. In-kind donor estimates never enter cash totals. */
export function statementGiving(gifts: StatementGift[]): {
  text: string
  totals: Array<Money & { exponent: number }>
  gifts: StatementGift[]
} {
  const seen = new Set<string>(),
    totals = new Map<string, { amount: bigint; exponent: number }>(),
    lines: string[] = []
  for (const gift of gifts) {
    if (!gift.id || seen.has(gift.id)) throw new Error('Choose each statement gift once.')
    seen.add(gift.id)
    assertMoney({ currency: gift.currency, minorUnits: gift.original_minor })
    assertMoney({ currency: gift.currency, minorUnits: gift.net_minor })
    if (
      BigInt(gift.original_minor) <= 0n ||
      BigInt(gift.net_minor) < 0n ||
      !Number.isSafeInteger(gift.revision) ||
      gift.revision < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(gift.received_on)
    )
      throw new Error('Choose valid recorded statement gifts.')
    documentAmount(gift.original_minor, gift.currency, gift.exponent)
    if (
      !['posted', 'void'].includes(gift.state) ||
      !['cash', 'check', 'external-online', 'in-kind'].includes(gift.kind)
    )
      throw new Error('Choose valid recorded statement gifts.')
    if (gift.state === 'void') {
      lines.push(`${gift.received_on} · ${gift.id} · Voided; excluded from received totals.`)
      continue
    }
    if (gift.kind === 'in-kind') {
      lines.push(
        `${gift.received_on} · ${gift.id} · In-kind contribution; no cash amount included.`,
      )
      continue
    }
    const prior = totals.get(gift.currency)
    if (prior && prior.exponent !== gift.exponent)
      throw new Error('Use consistent currency precision.')
    totals.set(gift.currency, {
      amount: (prior?.amount || 0n) + BigInt(gift.net_minor),
      exponent: gift.exponent,
    })
    lines.push(
      `${gift.received_on} · ${gift.id} · Received ${documentAmount(gift.original_minor, gift.currency, gift.exponent)}; current net ${documentAmount(gift.net_minor, gift.currency, gift.exponent)}.`,
    )
  }
  const amounts = [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => ({
      currency,
      minorUnits: value.amount.toString(),
      exponent: value.exponent,
    }))
  lines.push(
    '',
    'Received totals after recorded adjustments:',
    ...amounts.map((value) => documentAmount(value.minorUnits, value.currency, value.exponent)),
  )
  if (!amounts.length) lines.push('No received cash contributions in this selection.')
  lines.push(
    'Amounts reflect recorded gifts and adjustments at issuance. No tax deductibility determination is made by this document.',
  )
  return { text: lines.join('\n'), totals: amounts, gifts: gifts.map((gift) => ({ ...gift })) }
}
