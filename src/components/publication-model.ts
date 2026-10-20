export type PublicationMode = 'month' | 'week' | 'day'
export const publicationDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export function publicationDate(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00`)
    if (!Number.isNaN(date.getTime()) && publicationDay(date) === value) return date
  }
  return new Date()
}
export function publicationPeriod(date: Date, mode: PublicationMode) {
  const start = new Date(date.getFullYear(), date.getMonth(), mode === 'month' ? 1 : date.getDate())
  if (mode === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start)
  if (mode === 'month') end.setMonth(end.getMonth() + 1)
  else end.setDate(end.getDate() + (mode === 'week' ? 7 : 1))
  return { start, end }
}
export function shiftPublicationDate(date: Date, mode: PublicationMode, direction: number) {
  return mode === 'month'
    ? new Date(date.getFullYear(), date.getMonth() + direction, 1, 12)
    : new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + direction * (mode === 'week' ? 7 : 1),
        12,
      )
}
export function publicationDays(start: Date, end: Date) {
  const days: Date[] = []
  for (const cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1))
    days.push(new Date(cursor))
  return days
}
