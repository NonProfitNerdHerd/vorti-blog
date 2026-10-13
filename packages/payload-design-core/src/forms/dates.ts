/** Wall-clock conversion with explicit DST handling; never relies on the host timezone. */
export function zonedParts(instant: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
export function wallTimeToInstant(local: string, timezone: string, disambiguation: 'earlier' | 'later' | 'reject' = 'reject'): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)) throw new Error('Choose a date and time.')
  const guess = Date.parse(`${local}:00Z`)
  if (!Number.isFinite(guess)) throw new Error('Invalid date and time.')
  const offsets = new Set<number>()
  // Sample either side of transitions; timezone offsets are minute-granular for current dates.
  for (const hours of [-36, -12, 0, 12, 36]) {
    const time = guess + hours * 3600000
    offsets.add(Date.parse(`${zonedParts(new Date(time), timezone)}:00Z`) - time)
  }
  const candidates = [...offsets].map(offset => guess - offset).filter(time => zonedParts(new Date(time), timezone) === local).sort((a, b) => a - b)
  if (!candidates.length) throw new Error('This local time does not exist because the clocks change. Choose another time.')
  if (candidates.length > 1 && disambiguation === 'reject') throw new Error('This time occurs twice. Choose the earlier or later occurrence.')
  return new Date(disambiguation === 'later' ? candidates.at(-1)! : candidates[0]).toISOString()
}
