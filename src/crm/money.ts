/** Integer minor-unit strings on the wire; BigInt only within server calculations. */
export interface Money {
  currency: string
  minorUnits: string
}
export interface CurrencyDefinition {
  code: string
  exponent: number
}
export function formatMinor(value: string, exponent: number): string {
  const negative = value.startsWith('-'),
    digits = (negative ? value.slice(1) : value).padStart(exponent + 1, '0')
  return `${negative ? '-' : ''}${exponent ? digits.slice(0, -exponent) + '.' + digits.slice(-exponent) : digits}`
}
const minorPattern = /^-?(0|[1-9][0-9]*)$/
export function assertMoney(value: Money): void {
  if (
    !value || typeof value !== 'object' || typeof value.currency !== 'string' || typeof value.minorUnits !== 'string' ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !minorPattern.test(value.minorUnits) ||
    value.minorUnits === '-0' ||
    value.minorUnits.length > 31
  )
    throw new Error('Money requires a currency and a canonical integer minor-unit amount.')
}
export function parseMoney(amount: string, currency: CurrencyDefinition): Money {
  if (!Number.isInteger(currency.exponent) || currency.exponent < 0 || currency.exponent > 4)
    throw new Error('Unsupported currency precision.')
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(amount)
  if (!match || (match[3]?.length || 0) > currency.exponent)
    throw new Error('Enter an exact decimal amount using the currency precision.')
  const unsigned = BigInt(`${match[2]}${(match[3] || '').padEnd(currency.exponent, '0')}`)
  const value = {
    currency: currency.code,
    minorUnits: (match[1] ? -unsigned : unsigned).toString(),
  }
  assertMoney(value)
  return value
}
export function addMoney(values: Money[]): Money[] {
  const totals = new Map<string, bigint>()
  for (const value of values) {
    assertMoney(value)
    totals.set(value.currency, (totals.get(value.currency) || 0n) + BigInt(value.minorUnits))
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, minorUnits: total.toString() }))
}
export function validateAllocations(
  gift: Money,
  allocations: Array<Money & { fund: string }>,
): void {
  assertMoney(gift)
  if (BigInt(gift.minorUnits) <= 0n) throw new Error('A gift must have a positive amount.')
  const funds = new Set<string>()
  let total = 0n
  for (const allocation of allocations) {
    assertMoney(allocation)
    if (!allocation.fund || funds.has(allocation.fund))
      throw new Error('Each fund must appear once in a gift allocation.')
    if (allocation.currency !== gift.currency || BigInt(allocation.minorUnits) <= 0n)
      throw new Error('Allocations require positive amounts in the gift currency.')
    funds.add(allocation.fund)
    total += BigInt(allocation.minorUnits)
  }
  if (total !== BigInt(gift.minorUnits)) throw new Error('Allocations must equal the gift amount.')
}

export interface GiftLedgerRecord {
  id: string
  received: Money
  kind: 'cash' | 'check' | 'external-online' | 'in-kind'
  state: 'posted' | 'void'
  /** Refunds/corrections are signed deltas. Original entries are retained. */
  adjustments: Array<{ id: string; amount: Money; reason: string }>
}
/** Neither expected gifts nor in-kind estimates belong in the received cash ledger. */
export function receivedTotals(gifts: GiftLedgerRecord[]): Money[] {
  const seen = new Set<string>()
  const amounts: Money[] = []
  for (const gift of gifts) {
    if (seen.has(gift.id)) throw new Error('Duplicate gift in financial aggregation.')
    seen.add(gift.id)
    assertMoney(gift.received)
    if (BigInt(gift.received.minorUnits) <= 0n)
      throw new Error('Original gift amount must be positive.')
    const adjustmentIDs = new Set<string>()
    let net = BigInt(gift.received.minorUnits)
    for (const adjustment of gift.adjustments) {
      assertMoney(adjustment.amount)
      if (
        adjustmentIDs.has(adjustment.id) ||
        !adjustment.reason.trim() ||
        adjustment.amount.currency !== gift.received.currency
      )
        throw new Error('Invalid financial adjustment.')
      adjustmentIDs.add(adjustment.id)
      net += BigInt(adjustment.amount.minorUnits)
    }
    if (net < 0n) throw new Error('Adjustments cannot make a gift negative.')
    if (gift.state === 'posted' && gift.kind !== 'in-kind')
      amounts.push({ currency: gift.received.currency, minorUnits: net.toString() })
  }
  return addMoney(amounts)
}
