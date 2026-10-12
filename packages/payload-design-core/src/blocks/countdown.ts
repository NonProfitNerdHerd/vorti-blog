type Parts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}
function parts(time: number, timeZone: string): Parts {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(time)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Parts
}
const utc = (p: Parts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
function zoned(p: Parts, zone: string) {
  const wall = utc(p)
  // Resolve DST folds to the earlier occurrence; move gaps forward by the gap.
  const offsets = [-86400000, 0, 86400000].map((delta) => {
    const instant = wall + delta
    return utc(parts(instant, zone)) - instant
  })
  const candidates = [...new Set(offsets)].map((offset) => wall - offset).sort((a, b) => a - b)
  const exact = candidates.filter((instant) => utc(parts(instant, zone)) === wall)
  if (exact.length) return exact[0]
  return (
    candidates
      .filter((instant) => utc(parts(instant, zone)) > wall)
      .sort((a, b) => utc(parts(a, zone)) - utc(parts(b, zone)))[0] ?? NaN
  )
}
/** Public wall-clock schedule, shared by all visitors. No visitor-local epoch. */
export function countdownDeadline(
  deadline: string,
  zone = 'UTC',
  recurrence = 'none',
  now = Date.now(),
): number {
  const first = Date.parse(deadline)
  if (!Number.isFinite(first) || recurrence === 'none' || first > now) return first
  try {
    const start = parts(first, zone),
      current = parts(now, zone)
    let offset =
      recurrence === 'monthly'
        ? Math.max(0, (current.year - start.year) * 12 + current.month - start.month)
        : Math.max(
            0,
            Math.floor(
              (utc({ ...current, hour: 0, minute: 0, second: 0 }) -
                utc({ ...start, hour: 0, minute: 0, second: 0 })) /
                86400000 /
                (recurrence === 'weekly' ? 7 : 1),
            ),
          )
    for (let attempt = 0; attempt < 3; attempt++, offset++) {
      const date = new Date(
        Date.UTC(start.year, start.month - 1, recurrence === 'monthly' ? 1 : start.day),
      )
      if (recurrence === 'monthly') {
        date.setUTCMonth(date.getUTCMonth() + offset)
        const last = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
        ).getUTCDate()
        date.setUTCDate(Math.min(last, start.day))
      } else date.setUTCDate(date.getUTCDate() + offset * (recurrence === 'weekly' ? 7 : 1))
      const next = zoned(
        {
          ...start,
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
        },
        zone,
      )
      if (next > now) return next
    }
  } catch {
    return NaN
  }
  return NaN
}
