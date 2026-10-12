import type { EventSchedule, Occurrence } from './model'
const DAY = 86400000
const wallFormatters = new Map<string, Intl.DateTimeFormat>()
function wall(time: number, timezone: string) {
  let formatter = wallFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    if (wallFormatters.size >= 64) wallFormatters.clear()
    wallFormatters.set(timezone, formatter)
  }
  const p = Object.fromEntries(formatter.formatToParts(time).map((p) => [p.type, p.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}
/** Reject ambiguous or nonexistent user-entered wall times rather than silently shifting them. */
export function eventInstant(value: string, zone: string, strict = true): number {
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) return Date.parse(value)
  const normalized =
    value.length === 10 ? `${value}T00:00:00` : value.length === 16 ? `${value}:00` : value
  const target = Date.parse(`${normalized}Z`)
  if (!Number.isFinite(target)) throw new Error('Enter a valid event date and time')
  const candidates = [
    ...new Set(
      [-DAY, 0, DAY].map((delta) => {
        const probe = target + delta
        return target - (Date.parse(wall(probe, zone) + 'Z') - probe)
      }),
    ),
  ]
    .filter((candidate) => wall(candidate, zone) === normalized)
    .sort((a, b) => a - b)
  if (candidates.length !== 1 && strict)
    throw new Error(
      'This time is ambiguous or does not exist in the selected timezone. Enter an explicit UTC offset or choose another time.',
    )
  if (candidates.length) return candidates[0]
  // Generated recurrence in a DST gap moves forward by the gap.
  const later = [-DAY, 0, DAY]
    .map((delta) => target - (Date.parse(wall(target + delta, zone) + 'Z') - (target + delta)))
    .filter((t) => wall(t, zone) > normalized)
    .sort((a, b) => a - b)
  return later[0]
}
export function validateSchedule(s: EventSchedule) {
  if (!s || !s.timezone || !s.start || !s.end)
    throw new Error('Start, end, and timezone are required')
  new Intl.DateTimeFormat('en', { timeZone: s.timezone }).format()
  const start = eventInstant(s.start, s.timezone),
    end = eventInstant(s.end, s.timezone)
  if (!(end > start))
    throw new Error('Event end must be after its start; all-day end dates are exclusive')
  if (
    s.until &&
    eventInstant(s.until.length === 10 ? `${s.until}T23:59:59` : s.until, s.timezone) < start
  )
    throw new Error('Repeat end must be on or after the first occurrence')
  if ((s.exceptions?.length || 0) > 1000) throw new Error('A series supports up to 1000 exceptions')
  if (s.frequency && !['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(s.frequency))
    throw new Error('Invalid repeat frequency')
  if (
    s.interval !== undefined &&
    (!Number.isInteger(s.interval) || s.interval < 1 || s.interval > 999)
  )
    throw new Error('Repeat interval must be 1–999')
  if (s.count !== undefined && (!Number.isInteger(s.count) || s.count < 1 || s.count > 10000))
    throw new Error('Occurrence count must be 1–10000')
  if (
    s.weekdays?.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    s.monthDays?.some((d) => !Number.isInteger(d) || d < 1 || d > 31)
  )
    throw new Error('Invalid repeat days')
  const seen = new Set<string>()
  for (const exception of s.exceptions ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.date) || seen.has(exception.date))
      throw new Error('Exceptions need unique occurrence dates')
    eventInstant(exception.date, s.timezone)
    seen.add(exception.date)
    if (
      !exception.cancelled &&
      (!exception.start ||
        !exception.end ||
        eventInstant(exception.end, s.timezone) <= eventInstant(exception.start, s.timezone))
    )
      throw new Error('Rescheduled occurrences need valid start and end times')
  }
}
export function expandSchedule(
  s: EventSchedule,
  from: number,
  to: number,
  seriesID: string,
): Occurrence[] {
  validateSchedule(s)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * DAY)
    throw new Error('Calendar requests must cover at most 366 days')
  const first = eventInstant(s.start, s.timezone),
    end = eventInstant(s.end, s.timezone)
  const firstWall = wall(first, s.timezone),
    endWall = wall(end, s.timezone)
  const origin = Date.parse(firstWall.slice(0, 10) + 'T00:00:00Z'),
    duration = Date.parse(endWall + 'Z') - Date.parse(firstWall + 'Z')
  const base = new Date(origin),
    frequency = s.frequency || 'none',
    interval = s.interval || 1
  const until = s.until
    ? eventInstant(s.until.length === 10 ? s.until + 'T23:59:59' : s.until, s.timezone)
    : Infinity
  const results: Occurrence[] = []
  let count = 0
  // Bounded scan; reject pathological series instead of returning incomplete results.
  const scanEnd = Math.max(
    to,
    ...(s.exceptions ?? []).map((e) => Date.parse(e.date + 'T00:00:00Z') + DAY),
  )
  const days = frequency === 'none' ? 1 : Math.ceil((scanEnd - origin) / DAY) + 2
  if (days > 200000) throw new Error('Series exceeds the supported recurrence evaluation range')
  for (let d = 0; d < days; d++) {
    const date = new Date(origin + d * DAY),
      months =
        (date.getUTCFullYear() - base.getUTCFullYear()) * 12 +
        date.getUTCMonth() -
        base.getUTCMonth()
    const match =
      frequency === 'none'
        ? d === 0
        : frequency === 'daily'
          ? d % interval === 0
          : frequency === 'weekly'
            ? Math.floor(d / 7) % interval === 0 &&
              (s.weekdays?.length ? s.weekdays : [base.getUTCDay()]).includes(date.getUTCDay())
            : frequency === 'monthly'
              ? months % interval === 0 &&
                (s.monthDays?.length ? s.monthDays : [base.getUTCDate()]).includes(
                  date.getUTCDate(),
                )
              : (date.getUTCFullYear() - base.getUTCFullYear()) % interval === 0 &&
                date.getUTCMonth() === base.getUTCMonth() &&
                (s.monthDays?.length ? s.monthDays : [base.getUTCDate()]).includes(
                  date.getUTCDate(),
                )
    if (!match) continue
    const day = date.toISOString().slice(0, 10),
      scheduled = d === 0 ? first : eventInstant(day + firstWall.slice(10), s.timezone, false)
    if (scheduled < first) continue
    if (scheduled > until || (s.count && count >= s.count)) break
    count++
    const exception = s.exceptions?.find((e) => e.date === day)
    if (exception?.cancelled) continue
    const start = exception?.start ? eventInstant(exception.start, s.timezone) : scheduled
    let finish = exception?.end
      ? eventInstant(exception.end, s.timezone)
      : eventInstant(
          new Date(
            origin + d * DAY + Date.parse('1970-01-01' + firstWall.slice(10) + 'Z') + duration,
          )
            .toISOString()
            .slice(0, 19),
          s.timezone,
          false,
        )
    if (!exception?.end && d === 0) finish = end
    if (finish <= start) finish = start + (end - first)
    if (start < to && finish > from)
      results.push({
        id: `${seriesID}:${day}`,
        start: new Date(start).toISOString(),
        end: new Date(finish).toISOString(),
        originalDate: day,
        allDay: !!s.allDay,
        timezone: s.timezone,
      })
    if (results.length > 10000) throw new Error('Too many occurrences; narrow the date range')
  }
  return results.sort((a, b) => a.start.localeCompare(b.start))
}
