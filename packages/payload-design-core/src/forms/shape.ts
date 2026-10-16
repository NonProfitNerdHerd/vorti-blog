import type { FormIssue } from './model'
import { workflowIssues } from './workflow'
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value)
const text = (value: unknown) => typeof value === 'string'
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const list = (check: (value: unknown) => boolean) => (value: unknown) => Array.isArray(value) && value.length <= 1000 && value.every(item => check(item))
const keys = (value: Record<string, unknown>, names: string[], check: (value: unknown) => boolean) => names.every(name => optional(value[name], check))
const option = (value: unknown) => record(value) && text(value.id) && text(value.label) && text(value.value) && optional(value.image, text)
function condition(value: unknown, depth = 0): boolean {
  if (!record(value) || depth > 20) return false
  if ('all' in value) return list(child => condition(child, depth + 1))(value.all)
  if ('any' in value) return list(child => condition(child, depth + 1))(value.any)
  return text(value.field) && text(value.operator) && optional(value.compareField, text)
}
function effect(value: unknown): boolean {
  if (!record(value)) return false
  if (value.kind === 'confirmation') return text(value.message)
  if (!text(value.target)) return false
  if (['visible', 'enabled', 'required'].includes(String(value.kind))) return typeof value.value === 'boolean'
  if (value.kind === 'style') return ['highlight', 'muted', 'warning', 'success'].includes(String(value.value))
  return ['set', 'clear', 'route', 'action'].includes(String(value.kind))
}
function field(value: unknown, depth = 0): boolean {
  if (!record(value) || depth > 11 || !text(value.id) || !text(value.kind) || !text(value.label)) return false
  if (!keys(value, ['help', 'placeholder', 'errorMessage', 'expression', 'currency', 'blockLabel'], text) || !keys(value, ['required', 'sensitive', 'disabled'], x => typeof x === 'boolean')) return false
  if (!keys(value, ['min', 'max', 'minLength', 'maxLength', 'minChoices', 'maxChoices', 'precision', 'width'], number)) return false
  if (!optional(value.options, list(option)) || !optional(value.rows, list(option)) || !optional(value.children, list(child => field(child, depth + 1)))) return false
  const fraction = (x: unknown) => number(x) && Number(x) >= .1 && Number(x) <= 1 && Math.abs(Number(x) * 100 - Math.round(Number(x) * 100)) < .00001
  if (!optional(value.widthFraction, fraction)) return false
  if (value.contact !== undefined && (!record(value.contact) || !['full', 'firstLast', 'middleInitial', 'middle', 'us', 'international'].includes(String(value.contact.format)) || !optional(value.contact.line2, x => typeof x === 'boolean'))) return false
  if (value.components !== undefined && (!record(value.components) || Object.entries(value.components).some(([key, component]) => !['full', 'first', 'middle', 'last', 'line1', 'line2', 'city', 'region', 'postalCode', 'country', 'code', 'area', 'prefix', 'line', 'national'].includes(key) || !record(component) || !keys(component, ['label', 'help', 'placeholder'], text) || !optional(component.widthFraction, fraction)))) return false
  if (value.layout !== undefined && (!record(value.layout) || !(value.layout.kind === 'columns' ? optional(value.layout.width, width => ['inherit', 'content', 'full'].includes(String(width))) : value.layout.kind === 'column' && number(value.layout.weight) && Number(value.layout.weight) > 0 && Number(value.layout.weight) <= 100))) return false
  if (value.date !== undefined) {
    if (!record(value.date)) return false
    const date = value.date
    if (!keys(date, ['min', 'max', 'timezone', 'resource'], text) || !keys(date, ['minDaysFromToday', 'maxDaysFromToday', 'leadMinutes', 'incrementMinutes'], number)) return false
    if (!optional(date.excludedWeekdays, list(number)) || !optional(date.blackoutDates, list(text))) return false
    if (!optional(date.allowedRanges, list(range => record(range) && text(range.start) && text(range.end)))) return false
    if (!optional(date.businessHours, list(hours => record(hours) && number(hours.weekday) && text(hours.start) && text(hours.end)))) return false
  }
  if (value.files !== undefined && (!record(value.files) || !number(value.files.maxCount) || !number(value.files.maxBytes) || !list(text)(value.files.mimeTypes))) return false
  if (value.prefill !== undefined && (!record(value.prefill) || !['profile', 'query'].includes(String(value.prefill.source)) || !text(value.prefill.key))) return false
  if (value.choiceSource !== undefined && (!record(value.choiceSource) || !['collection', 'labelField', 'valueField'].every(key => text(value.choiceSource && (value.choiceSource as Record<string, unknown>)[key])))) return false
  return true
}

/** Safe on untrusted imports and API bodies. Drafts may be unfinished, but not structurally malformed. */
export function definitionShapeIssues(value: unknown): FormIssue[] {
  const issue = (message: string): FormIssue[] => [{ path: 'definition', message }]
  if (!record(value) || value.version !== 1 || !list(field)(value.fields)) return issue('Use a version 1 form definition with valid field objects and supported nesting.')
  if (value.workflow !== undefined && workflowIssues(value.workflow).length) return issue(workflowIssues(value.workflow).join(' '))
  if (!list(rule => record(rule) && text(rule.id) && text(rule.name) && condition(rule.when) && list(effect)(rule.effects))(value.rules)) return issue('Rules need an ID, name, valid conditions, and a supported effects list.')
  if (!list(action => record(action) && text(action.id) && text(action.kind) && text(action.name) && record(action.config) && optional(action.when, condition))(value.actions)) return issue('Actions need an ID, name, kind, settings object, and valid optional conditions.')
  if (!['standard', 'steps', 'conversational'].includes(String(value.mode)) || !['ltr', 'rtl'].includes(String(value.direction)) || !text(value.locale) || !text(value.confirmation) || !optional(value.redirect, text)) return issue('Choose a supported presentation mode, direction, locale, and confirmation message.')
  if (!record(value.theme) || !['primary', 'background', 'text', 'border', 'error', 'buttonLabel'].every(key => text(value.theme && (value.theme as Record<string, unknown>)[key])) || !number(value.theme.radius) || !number(value.theme.spacing)) return issue('Theme settings are incomplete or malformed.')
  if (!record(value.access) || !list(text)(value.access.origins) || !list(text)(value.access.embedOrigins)) return issue('Access settings need origin lists.')
  for (const key of ['authenticated', 'turnstile', 'saveProgress', 'autosaveProgress', 'analytics', 'analyticsConsent', 'publicResults']) if (typeof value.access[key] !== 'boolean') return issue(`Access setting ${key} must be on or off.`)
  for (const key of ['draftDays', 'retentionDays', 'ratePerMinute']) if (!number(value.access[key]) || Number(value.access[key]) < 1) return issue(`Access setting ${key} must be a positive number.`)
  if (value.payment !== undefined && (!record(value.payment) || !['stripe', 'simulator'].includes(String(value.payment.provider)) || !text(value.payment.amountField) || !text(value.payment.currency))) return issue('Payment settings need a supported provider, amount field, and currency.')
  return []
}
