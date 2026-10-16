import { expect, it } from 'vitest'
import { contactComponents, contactErrors, normalizePhone, widthFraction } from './contact'
import { emptyDefinition, type FormField } from './model'
import { evaluateForm, validateAnswers, validateDefinition } from './engine'

const phone: FormField = { id: 'phone', kind: 'phone', label: 'Phone', contact: { format: 'us' } }
it('normalizes formatted US phones without accepting arbitrary text or incomplete numbers', () => {
  for (const value of ['(312) 555-0123', '+1 312 555 0123', '3125550123']) {
    expect(normalizePhone(value, phone)).toBe('+13125550123')
    expect(contactErrors(value, phone)).toEqual([])
  }
  expect(contactErrors('garbage3125550123', phone)).not.toEqual([])
  expect(contactErrors('+1 312 55 0123', phone)).not.toEqual([])
  expect(contactErrors('+44 2071234567', { ...phone, contact: { format: 'international' } })).toEqual([])
  expect(contactErrors('555-1234', { ...phone, contact: undefined })).toEqual([])
  const definition = { ...emptyDefinition(), fields: [phone] }
  expect(evaluateForm(definition, { phone: '(312) 555-0123' }).answers.phone).toBe('+13125550123')
  expect(validateAnswers(definition, { phone: 'incomplete' }).issues.length).toBeGreaterThan(0)
})
it('validates Unicode names, optional initials, required US addresses and ZIP+4', () => {
  const name: FormField = { id: 'name', kind: 'name', label: 'Name', required: true, contact: { format: 'middleInitial' } }
  expect(contactErrors({ first: '李', last: 'O’Connor', middle: 'É.' }, name)).toEqual([])
  expect(contactErrors({ first: '李', last: 'O’Connor' }, name)).toEqual([])
  expect(contactErrors({ first: '李', last: 'O’Connor', middle: 'AB' }, name)).not.toEqual([])
  expect(contactErrors({ full: '李 明' }, { ...name, contact: { format: 'full' } })).toEqual([])
  const address: FormField = { id: 'address', kind: 'address', label: 'Address', required: true, contact: { format: 'us' } }
  const value = { line1: '1 Main St', city: 'Chicago', region: 'IL', postalCode: '60601-1234' }
  expect(contactErrors(value, address)).toEqual([])
  expect(contactErrors({ ...value, region: '' }, address)).not.toEqual([])
  expect(contactErrors({ postalCode: 'wrong' }, { ...address, required: false })).not.toEqual([])
  expect(contactErrors({ line1: '1 Main', city: 'London', country: 'UK' }, { ...address, contact: undefined })).toEqual([])
  expect(contactComponents(address).map(part => part.widthFraction)).toEqual([1, .5, .2, .3])
})
it('preserves legacy fractions and identifies defaults hidden by a changed format', () => {
  expect(widthFraction({ id: 'a', kind: 'text', label: 'A', width: 4 })).toBe(1 / 3)
  const field: FormField = { id: 'name', kind: 'name', label: 'Name', contact: { format: 'full' }, defaultValue: { first: 'Ada', last: 'Lovelace' } }
  expect(validateDefinition({ ...emptyDefinition(), fields: [field] }).some(issue => issue.message.includes('hidden'))).toBe(true)
  expect(field.defaultValue).toEqual({ first: 'Ada', last: 'Lovelace' })
  expect(validateDefinition({ ...emptyDefinition(), fields: [{ ...field, defaultValue: undefined, components: { city: { widthFraction: .6 } } }] }).some(issue => issue.message.includes('unavailable'))).toBe(true)
})
