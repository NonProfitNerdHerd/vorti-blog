/** Versioned public-safe contracts. Secrets belong to application integration records. */
export type FormValue = null | string | number | boolean | FormValue[] | { [key: string]: FormValue }
export type Answers = Record<string, FormValue>
export type FieldKind =
  | 'text' | 'textarea' | 'name' | 'email' | 'phone' | 'url' | 'address'
  | 'number' | 'currency' | 'slider' | 'select' | 'searchSelect' | 'radio'
  | 'checkbox' | 'multiSelect' | 'imageChoice' | 'date' | 'time' | 'datetime'
  | 'dateRange' | 'upload' | 'hidden' | 'calculated' | 'rating' | 'nps'
  | 'likert' | 'ranking' | 'signature' | 'repeater' | 'consent' | 'terms'
  | 'heading' | 'content' | 'divider' | 'section' | 'row' | 'step' | 'review'
export type Operator = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'in' | 'notIn' |
  'empty' | 'notEmpty' | 'gt' | 'gte' | 'lt' | 'lte' | 'before' | 'after'
export type Condition = { all: Condition[] } | { any: Condition[] } |
  { field: string; operator: Operator; value?: FormValue; compareField?: string }
export type RuleEffect =
  | { kind: 'visible' | 'enabled' | 'required'; target: string; value: boolean }
  | { kind: 'set'; target: string; value: FormValue }
  | { kind: 'clear'; target: string }
  | { kind: 'style'; target: string; value: 'highlight' | 'muted' | 'warning' | 'success' }
  | { kind: 'route'; target: string }
  | { kind: 'confirmation'; message: string }
  | { kind: 'action'; target: string }
export interface FormRule { id: string; name: string; when: Condition; effects: RuleEffect[] }
export interface FormOption { id: string; label: string; value: string; image?: string }
export interface DateRestrictions {
  min?: string; max?: string; minDaysFromToday?: number; maxDaysFromToday?: number
  excludedWeekdays?: number[]; blackoutDates?: string[]; allowedRanges?: { start: string; end: string }[]
  leadMinutes?: number; businessHours?: { weekday: number; start: string; end: string }[]
  incrementMinutes?: number; timezone?: string; resource?: string
}
export interface FormField {
  id: string; kind: FieldKind | (string & {}); label: string; help?: string; placeholder?: string
  required?: boolean; defaultValue?: FormValue; sensitive?: boolean; disabled?: boolean
  width?: 3 | 4 | 6 | 8 | 9 | 12; children?: FormField[]; options?: FormOption[]
  layout?: { kind: 'columns'; width?: 'inherit' | 'content' | 'full' } | { kind: 'column'; weight: number }
  rows?: FormOption[]; min?: number; max?: number; minLength?: number; maxLength?: number
  minChoices?: number; maxChoices?: number; errorMessage?: string; expression?: string
  currency?: string; precision?: number; date?: DateRestrictions
  files?: { maxCount: number; maxBytes: number; mimeTypes: string[] }
  prefill?: { source: 'profile' | 'query'; key: string }
  choiceSource?: { collection: string; labelField: string; valueField: string }
  group?: { id: string; mode: 'copy' | 'linked'; revision: string }
}
export interface FormAction {
  id: string; kind: string; name: string; when?: Condition; requiresPayment?: boolean
  config: Record<string, FormValue>
}
export interface FormTheme {
  font: 'inherit' | 'sans-serif' | 'serif'; primary: string; background: string; text: string
  border: string; error: string; radius: number; spacing: number; size: 'compact' | 'regular' | 'large'
  labelPosition: 'above' | 'beside'; progress: 'bar' | 'steps'; buttonLabel: string
}
export interface FormDefinition {
  workflow?: import('./workflow').EntryWorkflow
  version: 1; mode: 'standard' | 'steps' | 'conversational'; locale: string; direction: 'ltr' | 'rtl'
  fields: FormField[]; rules: FormRule[]; actions: FormAction[]; theme: FormTheme
  confirmation: string; redirect?: string
  access: {
    authenticated: boolean; origins: string[]; embedOrigins: string[]; turnstile: boolean
    saveProgress: boolean; autosaveProgress: boolean; draftDays: number; analytics: boolean
    analyticsConsent: boolean; publicResults: boolean; retentionDays: number; ratePerMinute: number
  }
  payment?: { provider: 'stripe' | 'simulator'; amountField: string; currency: string }
}
export interface FormIssue { path: string; message: string; field?: string; rule?: string; action?: string }
export const defaultTheme: FormTheme = {
  font: 'inherit', primary: '#2563eb', background: '#ffffff', text: '#171717', border: '#a3a3a3',
  error: '#b91c1c', radius: 6, spacing: 16, size: 'regular', labelPosition: 'above',
  progress: 'bar', buttonLabel: 'Submit',
}
export const emptyDefinition = (): FormDefinition => ({
  version: 1, mode: 'standard', locale: 'en', direction: 'ltr', fields: [], rules: [], actions: [],
  theme: { ...defaultTheme }, confirmation: 'Thank you. Your response has been received.',
  access: { authenticated: false, origins: [], embedOrigins: [], turnstile: false,
    saveProgress: true, autosaveProgress: false, draftDays: 30, analytics: false,
    analyticsConsent: true, publicResults: false, retentionDays: 365, ratePerMinute: 10 },
})
export function flattenFields(fields: FormField[]): FormField[] {
  return fields.flatMap(field => [field, ...flattenFields(field.children || [])])
}
export function makeID(prefix = 'field'): string { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` }
export const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === '' ||
  (Array.isArray(value) && value.length === 0)
export function answerFields(fields: FormField[], answers: Answers, prefix = ''): { field: FormField; value: FormValue | undefined; path: string }[] {
  return fields.flatMap(field => {
    const path = `${prefix}${field.id}`, value = answers[field.id]
    return [{ field, value, path }, ...(field.kind === 'repeater' && Array.isArray(value)
      ? value.flatMap((row, index) => row && typeof row === 'object' && !Array.isArray(row) ? answerFields(field.children || [], row, `${path}.${index}.`) : [])
      : field.kind !== 'repeater' ? answerFields(field.children || [], answers, prefix) : [])]
  })
}
export function attachmentReferences(fields: FormField[], answers: Answers): { field: FormField; references: string[]; path: string }[] {
  return answerFields(fields, answers).filter(item => item.field.kind === 'upload').map(item => ({ field: item.field, path: item.path, references: Array.isArray(item.value) ? item.value.filter((value): value is string => typeof value === 'string') : [] }))
}
