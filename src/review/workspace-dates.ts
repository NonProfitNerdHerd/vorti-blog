import { nextTaskDay } from './dashboard-model'

export function siteCalendarDay(value: Date | string, timezone = 'UTC') {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (name: string) => parts.find((item) => item.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
/** Find the actual start of a site calendar day, including daylight-saving transitions. */
export function siteDayStart(day: string, timezone = 'UTC') {
  const nominal = Date.parse(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(nominal)) throw new Error('Choose a valid calendar date.')
  let low = nominal - 36 * 3600000,
    high = nominal + 36 * 3600000
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (siteCalendarDay(new Date(middle), timezone) < day) low = middle + 1
    else high = middle
  }
  return low
}
export function siteWeek(day: string, timezone = 'UTC') {
  const date = new Date(`${day}T12:00:00Z`)
  const monday = nextTaskDay(day, -((date.getUTCDay() + 6) % 7)),
    next = nextTaskDay(monday, 7)
  return {
    monday,
    sunday: nextTaskDay(monday, 6),
    start: siteDayStart(monday, timezone),
    end: siteDayStart(next, timezone),
  }
}
export function secondsInWindow(
  startedAt: string,
  endedAt: string,
  window: { start: number; end: number },
) {
  return Math.max(
    0,
    Math.floor(
      (Math.min(Date.parse(endedAt), window.end) - Math.max(Date.parse(startedAt), window.start)) /
        1000,
    ),
  )
}
export function localTimeInput(iso: string) {
  const date = new Date(iso),
    pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
export function parseLocalTime(input: string) {
  const normalized = input.length === 16 ? `${input}:00` : input,
    date = new Date(input)
  if (!Number.isFinite(date.getTime()) || localTimeInput(date.toISOString()) !== normalized)
    throw new Error(
      'Choose a valid local clock time. This time may fall in a daylight-saving transition.',
    )
  return date.toISOString()
}
