import type { FormField, FormValue } from './model'

export const blockLabel = (field: FormField) => field.blockLabel || field.label
export const widthFraction = (field: FormField) => field.widthFraction ?? (field.width || 12) / 12
export const widthStyle = (fraction: number) => ({ '--part-width': fraction } as import('react').CSSProperties)
export const usStates = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI AA AE AP'.split(' ')
export interface ContactComponent { key: string; label: string; widthFraction: number; autocomplete?: string; help?: string; placeholder?: string }
export function contactComponents(field: FormField): ContactComponent[] {
  const format = field.contact?.format
  let parts: [string, string, number, string?][] = []
  if (field.kind === 'name') parts = format === 'full' ? [['full', 'Full name', 1, 'name']] : [
    ['first', 'First name', format === 'middleInitial' ? .45 : format === 'middle' ? .33 : .5, 'given-name'],
    ...(['middle', 'middleInitial'].includes(format || '') ? [['middle', format === 'middleInitial' ? 'Middle initial' : 'Middle name', format === 'middleInitial' ? .1 : .34, 'additional-name'] as [string, string, number, string]] : []),
    ['last', 'Last name', format === 'middleInitial' ? .45 : format === 'middle' ? .33 : .5, 'family-name'],
  ]
  if (field.kind === 'address') parts = format === 'us' ? [['line1', 'Address', 1, 'address-line1'], ...(field.contact?.line2 ? [['line2', 'Address Line 2', 1, 'address-line2'] as [string, string, number, string]] : []), ['city', 'City', .5, 'address-level2'], ['region', 'State', .2, 'address-level1'], ['postalCode', 'ZIP', .3, 'postal-code']] : [['line1', 'Address', 1, 'address-line1'], ['line2', 'Address Line 2', 1, 'address-line2'], ['city', 'City', .4, 'address-level2'], ['region', 'Region', .3, 'address-level1'], ['postalCode', 'Postal Code', .3, 'postal-code'], ['country', 'Country', 1, 'country-name']]
  if (field.kind === 'phone' && format) parts = format === 'us' ? [['code', 'Country code', .2, 'tel-country-code'], ['area', 'Area code', .25, 'tel-area-code'], ['prefix', 'Three digits', .25, 'tel-local-prefix'], ['line', 'Four digits', .3, 'tel-local-suffix']] : [['code', 'Country calling code', .25, 'tel-country-code'], ['national', 'National number', .75, 'tel-national']]
  return parts.map(([key, label, width, autocomplete]) => ({ key, label: format ? label : key.replace(/([A-Z])/g, ' $1'), widthFraction: width, autocomplete, ...field.components?.[key] }))
}
export function normalizePhone(value: FormValue, field: FormField): FormValue {
  if (field.kind !== 'phone' || field.contact?.format !== 'us' || typeof value !== 'string') return value
  if (!/^[+()\d\s.\-]+$/.test(value)) return value
  const digits = value.replace(/\D/g, '')
  return /^\d{10}$/.test(digits) ? '+1' + digits : /^1\d{10}$/.test(digits) ? '+' + digits : value
}
export function normalizeContact(value: FormValue, field: FormField): FormValue {
  if (field.kind === 'phone') return normalizePhone(value, field)
  if (field.kind === 'repeater' && Array.isArray(value)) return value.map(row => row && typeof row === 'object' && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).map(([key, answer]) => [key, field.children?.find(child => child.id === key) ? normalizeContact(answer, field.children.find(child => child.id === key)!) : answer])) : row)
  if (field.kind === 'address' && field.contact?.format === 'us' && value && typeof value === 'object' && !Array.isArray(value) && !value.country) return { ...value, country: 'US' }
  return value
}
export function contactErrors(value: FormValue, field: FormField): string[] {
  const format = field.contact?.format
  if (field.kind === 'phone') {
    if (typeof value !== 'string') return ['Enter a phone number.']
    if (format === 'us') return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(String(normalizePhone(value, field))) ? [] : ['Enter a complete US phone number: area code, three digits, and four digits.']
    if (format === 'international') return /^\+[1-9]\d{0,2} [0-9]{4,14}$/.test(value) && value.replace(/\D/g, '').length <= 15 ? [] : ['Enter a country calling code and national number (up to 15 digits total).']
    return /^[+()\d\s.\-]{5,30}$/.test(value) && (value.match(/\d/g)?.length || 0) >= 5 ? [] : ['Enter a phone number.']
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Enter the structured values.']
  const allowed = field.kind === 'name' ? ['first', 'last', ...(format ? ['full', 'middle'] : [])] : ['line1', 'line2', 'city', 'region', 'postalCode', 'country']
  if (Object.entries(value).some(([key, val]) => !allowed.includes(key) || typeof val !== 'string' || val.length > 1000)) return ['Unexpected or invalid structured value.']
  const required = field.kind === 'name' ? format === 'full' ? ['full'] : ['first', 'last'] : format === 'us' ? ['line1', 'city', 'region', 'postalCode'] : ['line1', 'city', 'country']
  const errors = field.required && required.some(key => !String(value[key] || '').trim()) ? ['Complete ' + required.map(key => contactComponents(field).find(part => part.key === key)?.label || key).join(', ') + '.'] : []
  if (format === 'middleInitial' && value.middle && !/^\p{L}\.?$/u.test(String(value.middle).trim())) errors.push('Enter one letter for the middle initial, optionally followed by a period.')
  if (field.kind === 'address' && format === 'us') {
    if (value.region && !usStates.includes(String(value.region))) errors.push('Choose a US state or territory.')
    if (value.postalCode && !/^\d{5}(-\d{4})?$/.test(String(value.postalCode))) errors.push('Enter a five-digit ZIP or ZIP+4.')
    if (value.country && value.country !== 'US') errors.push('Use international address format for addresses outside the US.')
  }
  return errors
}
