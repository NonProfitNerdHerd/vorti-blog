import { assertMoney } from './money'

export const givingFrequencies = ['weekly', 'monthly', 'quarterly', 'annually'] as const
export type GivingFrequency = (typeof givingFrequencies)[number]
export function givingDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '9999-12-31'
  )
    throw new Error('Choose a valid calendar date.')
  const date = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Choose a valid calendar date.')
  return value
}
/** Every period is anchored to the original date: Jan 31 → Feb 28 → Mar 31. */
export function givingDueOn(
  start: string,
  frequency: GivingFrequency,
  ordinal: number,
): string | null {
  givingDate(start)
  if (
    !givingFrequencies.includes(frequency) ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0 ||
    ordinal > 500000
  )
    throw new Error('Choose a valid giving period.')
  const [year, month, day] = start.split('-').map(Number)
  if (frequency === 'weekly') {
    const date = new Date(start + 'T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + ordinal * 7)
    return date.getUTCFullYear() > 9999 ? null : date.toISOString().slice(0, 10)
  }
  const offset = ordinal * (frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12)
  const absolute = year * 12 + month - 1 + offset,
    nextYear = Math.floor(absolute / 12),
    nextMonth = absolute % 12
  if (nextYear > 9999) return null
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate()
  return `${nextYear.toString().padStart(4, '0')}-${(nextMonth + 1).toString().padStart(2, '0')}-${Math.min(day, lastDay).toString().padStart(2, '0')}`
}
export interface GivingInstallment {
  key: string
  dueOn: string
  minorUnits: string
}
export interface GivingPause {
  started_on: string
  resumed_on: string | null
}
export function recurringPage(input: {
  start: string
  end: string | null
  frequency: GivingFrequency
  minorUnits: string
  pauses: GivingPause[]
  after?: number
  limit?: number
}) {
  const after = input.after ?? 0,
    limit = input.limit ?? 24
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    after > 500000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Choose a valid giving page.')
  const docs: Array<GivingInstallment & { ordinal: number; skipped: boolean }> = []
  for (let ordinal = after; ordinal < after + limit; ordinal++) {
    const dueOn = givingDueOn(input.start, input.frequency, ordinal)
    if (!dueOn || (input.end && dueOn > input.end)) break
    docs.push({
      key: String(ordinal),
      ordinal,
      dueOn,
      minorUnits: input.minorUnits,
      skipped: input.pauses.some(
        (p) => dueOn >= p.started_on && (!p.resumed_on || dueOn < p.resumed_on),
      ),
    })
  }
  const nextDate = givingDueOn(input.start, input.frequency, after + docs.length)
  return {
    docs,
    next: nextDate && (!input.end || nextDate <= input.end) ? after + docs.length : null,
  }
}
export function equalInstallments(
  total: string,
  currency: string,
  start: string,
  frequency: GivingFrequency,
  count: number,
): GivingInstallment[] {
  assertMoney({ currency, minorUnits: total })
  if (
    BigInt(total) <= 0n ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 120 ||
    BigInt(total) < BigInt(count)
  )
    throw new Error('Choose one to 120 positive pledge installments.')
  const base = BigInt(total) / BigInt(count),
    extra = BigInt(total) % BigInt(count)
  return Array.from({ length: count }, (_, i) => {
    const dueOn = givingDueOn(start, frequency, i)
    if (!dueOn) throw new Error('Choose a pledge schedule ending before year 10000.')
    return { key: String(i), dueOn, minorUnits: (base + (BigInt(i) < extra ? 1n : 0n)).toString() }
  })
}
/** Unallocated cash absorbs refunds first; allocated credit then reduces proportionally.
 * Largest remainders, ordered by stable application ID, preserve every minor unit exactly. */
export function effectiveGivingCredits(
  netMinor: string,
  applications: Array<{ id: string; minorUnits: string }>,
): Map<string, string> {
  const net = BigInt(netMinor),
    total = applications.reduce((sum, a) => sum + BigInt(a.minorUnits), 0n)
  if (
    net < 0n ||
    applications.some((a) => BigInt(a.minorUnits) <= 0n) ||
    new Set(applications.map((a) => a.id)).size !== applications.length
  )
    throw new Error('Invalid payment allocation history.')
  if (!total) return new Map()
  const available = net < total ? net : total
  const rows = applications.map((a) => ({
    id: a.id,
    minor: (BigInt(a.minorUnits) * available) / total,
    remainder: (BigInt(a.minorUnits) * available) % total,
  }))
  let left = available - rows.reduce((sum, r) => sum + r.minor, 0n)
  rows.sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
  )
  for (const row of rows)
    if (left > 0n) {
      row.minor++
      left--
    }
  return new Map(rows.map((r) => [r.id, r.minor.toString()]))
}
