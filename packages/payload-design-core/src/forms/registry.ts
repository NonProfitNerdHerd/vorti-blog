import type { FormField, FormValue } from './model'
import { isEmpty } from './model'

export interface FieldRegistration {
  kind: string; label: string; category: 'Basic' | 'Choices' | 'Dates' | 'Advanced' | 'Layout'
  description: string; input?: string; structural?: boolean; choices?: boolean; numeric?: boolean
  validate: (value: FormValue, field: FormField) => string[]
  format: (value: FormValue, field: FormField) => string
}
/** Registries reject collisions so a plugin cannot silently change stored semantics. */
export class Registry<T extends { kind: string }> {
  private entries = new Map<string, T>()
  register(value: T): void {
    if (this.entries.has(value.kind)) throw new Error(`Already registered: ${value.kind}`)
    this.entries.set(value.kind, value)
  }
  get(kind: string): T | undefined { return this.entries.get(kind) }
  list(): T[] { return [...this.entries.values()] }
}
export const formFields = new Registry<FieldRegistration>()
export const structuredFormat = (value: FormValue): string => {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
const stringValue = (value: FormValue): string[] => typeof value === 'string' ? [] : ['Enter text.']
const numberValue = (value: FormValue, field: FormField): string[] => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ['Enter a valid number.']
  if (field.kind === 'nps' && (!Number.isInteger(value) || value < 0 || value > 10)) return ['Choose a score from 0 to 10.']
  if (field.kind === 'rating' && (!Number.isInteger(value) || value < (field.min ?? 1) || value > Math.min(field.max ?? 5, 20))) return ['Choose an available rating.']
  return [...(field.min !== undefined && value < field.min ? [`Minimum is ${field.min}.`] : []),
    ...(field.max !== undefined && value > field.max ? [`Maximum is ${field.max}.`] : [])]
}
const objectValue = (value: FormValue): string[] => value && typeof value === 'object' && !Array.isArray(value) ? [] : ['Enter the structured values.']
const register = (kind: string, label: string, category: FieldRegistration['category'], description: string,
  extra: Partial<FieldRegistration> = {}) => formFields.register({ kind, label, category, description,
  validate: stringValue, format: structuredFormat, ...extra })
register('text', 'Single-line text', 'Basic', 'A short answer.')
register('textarea', 'Paragraph', 'Basic', 'A longer answer.')
const structuredText = (keys: string[], requiredKeys: string[]) => (value: FormValue, field: FormField): string[] => {
  if (objectValue(value).length) return ['Enter the structured values.']
  const record = value as Record<string, FormValue>
  if (Object.entries(record).some(([key, val]) => !keys.includes(key) || typeof val !== 'string' || val.length > 1000)) return ['Unexpected or invalid structured value.']
  return field.required && requiredKeys.some(key => !String(record[key] || '').trim()) ? [`Complete ${requiredKeys.join(', ')}.`] : []
}
register('name', 'Name', 'Basic', 'First and last name stored separately.', { validate: structuredText(['first', 'last'], ['first', 'last']) })
register('address', 'Address', 'Basic', 'Structured postal address.', { validate: structuredText(['line1', 'line2', 'city', 'region', 'postalCode', 'country'], ['line1', 'city', 'country']) })
register('email', 'Email', 'Basic', 'A valid email address.', { input: 'email', validate: v =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? [] : ['Enter a valid email address.'] })
register('phone', 'Phone', 'Basic', 'International or local telephone number.', { input: 'tel', validate: v =>
  typeof v === 'string' && /^[+()\d\s.\-]{5,30}$/.test(v) && (v.match(/\d/g)?.length || 0) >= 5 ? [] : ['Enter a phone number.'] })
register('url', 'Website', 'Basic', 'An HTTP or HTTPS website address.', { input: 'url', validate: v => {
  try { return typeof v === 'string' && ['http:', 'https:'].includes(new URL(v).protocol) ? [] : ['Enter an HTTP or HTTPS URL.'] } catch { return ['Enter a valid URL.'] }
} })
for (const [kind, label] of [['number', 'Number'], ['currency', 'Currency'], ['slider', 'Slider'], ['rating', 'Rating'], ['nps', 'Net Promoter Score'], ['calculated', 'Calculated total']])
  register(kind, label, kind === 'calculated' ? 'Advanced' : 'Basic', 'Numeric answer with configured range.', { numeric: true, input: 'number', validate: numberValue })
for (const [kind, label] of [['select', 'Dropdown'], ['searchSelect', 'Searchable dropdown'], ['radio', 'Radio buttons'], ['multiSelect', 'Multiple choices'], ['imageChoice', 'Image choices'], ['ranking', 'Ranking']])
  register(kind, label, 'Choices', 'Choose from stable, labeled options.', { choices: true, validate: (value, field) => {
    const many = ['multiSelect', 'ranking'].includes(kind)
    if (many ? !Array.isArray(value) : typeof value !== 'string') return [many ? 'Select a list of options.' : 'Choose one option.']
    const values = many ? value as FormValue[] : [value]
    const errors = values.some(v => !field.options?.some(o => o.id === v)) ? ['Choose an available option.'] : []
    if (new Set(values).size !== values.length) errors.push('Choices must not repeat.')
    if (field.minChoices !== undefined && values.length < field.minChoices) errors.push(`Choose at least ${field.minChoices}.`)
    if (field.maxChoices !== undefined && values.length > field.maxChoices) errors.push(`Choose at most ${field.maxChoices}.`)
    if (kind === 'ranking' && values.length !== field.options?.length) errors.push('Rank every option.')
    return errors
  }, format: (value, field) => (Array.isArray(value) ? value : [value]).map(id => field.options?.find(o => o.id === id)?.label || String(id)).join('; ') })
for (const [kind, label] of [['checkbox', 'Checkbox'], ['consent', 'Consent'], ['terms', 'Terms acknowledgment']])
  register(kind, label, 'Choices', 'Explicit true/false acknowledgment.', { validate: v => typeof v === 'boolean' ? [] : ['Choose yes or no.'] })
for (const [kind, label, input] of [['date', 'Date', 'date'], ['time', 'Time', 'time'], ['datetime', 'Date and time', 'datetime-local']])
  register(kind, label, 'Dates', 'Date-only values remain separate from timezone-aware instants.', { input, validate: v => {
    if (typeof v !== 'string') return ['Choose a valid date or time.']
    if (kind === 'time') return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) ? [] : ['Enter a valid time.']
    if (kind === 'date') return validDate(v) ? [] : ['Enter a valid calendar date.']
    return /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? [] : ['Date and time must include an explicit timezone offset.']
  } })
register('dateRange', 'Date range', 'Dates', 'Start and end calendar dates.', { validate: v => {
  if (objectValue(v).length) return ['Select start and end dates.']
  const { start, end } = v as Record<string, FormValue>
  return typeof start === 'string' && typeof end === 'string' && validDate(start) && validDate(end) && end >= start ? [] : ['End date must be on or after a valid start date.']
} })
register('upload', 'File upload', 'Advanced', 'Private attachments with ownership validation.', { validate: v =>
  Array.isArray(v) && v.every(id => typeof id === 'string') ? [] : ['Upload references must be a list.'] })
register('hidden', 'Hidden value', 'Advanced', 'A protected configured value; never trusted from URL parameters.')
register('likert', 'Likert matrix', 'Choices', 'One response per row.', { choices: true, validate: (v, f) => {
  if (objectValue(v).length) return ['Answer the matrix rows.']
  const value = v as Record<string, FormValue>
  return Object.keys(value).some(id => !f.rows?.some(row => row.id === id)) || Object.values(value).some(id => !f.options?.some(o => o.id === id)) || (f.required && f.rows?.some(row => isEmpty(value[row.id]))) ? ['Choose an available answer for each required row.'] : []
} })
register('signature', 'Signature', 'Advanced', 'Draw a signature or use an accessible typed name.', { validate: v => {
  if (objectValue(v).length) return ['Sign or type your name.']
  const value = v as Record<string, FormValue>
  if (value.mode === 'typed') return typeof value.name === 'string' && value.name.trim().length >= 2 && value.name.length <= 200 ? [] : ['Type your full name.']
  if (value.mode === 'drawn') return Array.isArray(value.strokes) && value.strokes.length > 0 && value.strokes.length <= 100 && value.strokes.every(stroke => Array.isArray(stroke) && stroke.length <= 2000 && stroke.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && n >= 0 && n <= 1))) ? [] : ['Draw a valid signature.']
  return ['Choose a signature method.']
} })
register('repeater', 'Repeatable group', 'Advanced', 'A bounded list of structured entries.', { validate: (v, f) => {
  if (!Array.isArray(v) || v.some(row => objectValue(row).length)) return ['Enter a list of grouped answers.']
  return v.length > (f.max ?? 50) || v.length < (f.min ?? 0) ? ['Number of repeated entries is outside the allowed range.'] : []
} })
for (const [kind, label] of [['heading', 'Heading'], ['content', 'Explanatory text'], ['divider', 'Divider'], ['section', 'Section'], ['row', 'Columns'], ['step', 'Canvas'], ['review', 'Submission review']])
  register(kind, label, 'Layout', 'Organize or explain the form without collecting an answer.', { structural: true, validate: () => [] })
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d\d-\d\d$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
