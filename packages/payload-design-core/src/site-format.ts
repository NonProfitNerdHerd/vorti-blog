export type SiteFormat = {
  timezone?: string | null
  dateFormat?: string | null
  timeFormat?: string | null
}
export const dateFormats = [
  { value: 'long', label: 'October 17, 2026' },
  { value: 'short', label: 'Oct 17, 2026' },
  { value: 'iso', label: '2026-10-17' },
  { value: 'us', label: '10/17/2026' },
  { value: 'day-first', label: '17/10/2026' },
]
export const timeFormats = [
  { value: '12', label: '1:30 PM' },
  { value: '24', label: '13:30' },
]

export function formatSiteDate(
  input: string | Date,
  settings: SiteFormat = {},
  zone?: string,
): string {
  // Date-only values represent calendar days, not instants in the viewer's zone.
  const dateOnly = typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
  const date = new Date(dateOnly ? `${input}T12:00:00Z` : input)
  if (Number.isNaN(date.getTime())) return ''
  const timeZone = dateOnly ? 'UTC' : zone || settings.timezone || 'UTC'
  const format = settings.dateFormat || 'long'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (key: string) => parts.find((p) => p.type === key)?.value || ''
  if (format === 'iso') return `${part('year')}-${part('month')}-${part('day')}`
  if (format === 'us') return `${part('month')}/${part('day')}/${part('year')}`
  if (format === 'day-first') return `${part('day')}/${part('month')}/${part('year')}`
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: format === 'short' ? 'short' : 'long',
    day: 'numeric',
  }).format(date)
}
export function formatSiteTime(
  input: string | Date,
  settings: SiteFormat = {},
  zone?: string,
): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone || settings.timezone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: settings.timeFormat !== '24',
  }).format(date)
}
