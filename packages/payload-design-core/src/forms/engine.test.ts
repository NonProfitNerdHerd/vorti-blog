import { describe, expect, it } from 'vitest'
import { calculate, expressionReferences } from './expression'
import { evaluateForm, validateAnswers, validateDate, validateDefinition, validateTemporal } from './engine'
import { emptyDefinition, type FormDefinition } from './model'
import { wallTimeToInstant } from './dates'
import { definitionShapeIssues } from './shape'

function example(): FormDefinition {
  return { ...emptyDefinition(), fields: [
    { id: 'quantity', kind: 'number', label: 'Quantity', required: true, min: 1 },
    { id: 'price', kind: 'number', label: 'Price', defaultValue: 2.5 },
    { id: 'total', kind: 'calculated', label: 'Total', expression: 'round([quantity] * [price], 2)' },
    { id: 'reason', kind: 'text', label: 'Reason', required: true },
  ], rules: [{ id: 'hide', name: 'Small orders', when: { field: 'quantity', operator: 'lt', value: 10 }, effects: [{ kind: 'visible', target: 'reason', value: false }] }] }
}
describe('calendar restrictions are authoritative', () => {
  it('checks business hours and minute increments in the configured timezone', () => {
    const field = { id: 'visit', kind: 'datetime', label: 'Visit', date: { timezone: 'America/Chicago', incrementMinutes: 30, businessHours: [{ weekday: 1, start: '09:00', end: '17:00' }] } }
    const now = new Date('2026-10-12T00:00:00Z')
    expect(validateTemporal(field, '2026-10-12T14:30:00Z', now)).toEqual([])
    expect(validateTemporal(field, '2026-10-12T14:15:00Z', now).join(' ')).toContain('increments')
    expect(validateTemporal(field, '2026-10-12T22:00:00Z', now).join(' ')).toContain('business hours')
    expect(validateTemporal(field, '2026-10-13T14:30:00Z', now).join(' ')).toContain('business hours')
  })
  it('measures lead time across the fall-back transition by elapsed time', () => {
    const field = { id: 'visit', kind: 'datetime', label: 'Visit', date: { timezone: 'America/Chicago', leadMinutes: 60 } }
    const now = new Date('2026-11-01T06:00:00Z')
    expect(validateTemporal(field, '2026-11-01T01:30:00-05:00', now).join(' ')).toContain('60 minutes')
    expect(validateTemporal(field, '2026-11-01T01:30:00-06:00', now)).toEqual([])
  })
  it('rejects blackout dates inside a range even when both endpoints are available', () => {
    const field = { id: 'stay', kind: 'dateRange', label: 'Stay', date: { blackoutDates: ['2026-10-14'] } }
    expect(validateTemporal(field, { start: '2026-10-12', end: '2026-10-16' }, new Date()).join(' ')).toContain('unavailable')
  })
  it('runs restrictions through the same submission validator', () => {
    const definition = emptyDefinition()
    definition.fields = [{ id: 'visit', kind: 'datetime', label: 'Visit', date: { timezone: 'UTC', incrementMinutes: 30 } }]
    expect(validateAnswers(definition, { visit: '2026-10-12T12:05:00Z' }).issues[0].field).toBe('visit')
    definition.fields[0].date!.incrementMinutes = 0
    expect(validateDefinition(definition).some(issue => issue.message.includes('increment'))).toBe(true)
  })
})
describe('untrusted definition shape', () => {
  it('returns recoverable errors for malformed field options, conditions and date settings', () => {
    for (const invalid of [
      { ...emptyDefinition(), fields: [{ id: 'a', kind: 'select', label: 'Choice', options: {} }] },
      { ...emptyDefinition(), rules: [{ id: 'rule', name: 'Rule', when: 1, effects: [] as unknown[] }] },
      { ...emptyDefinition(), fields: [{ id: 'a', kind: 'date', label: 'Date', date: { businessHours: 'Monday' } }] },
      { ...emptyDefinition(), access: {} },
    ]) expect(definitionShapeIssues(invalid).length).toBeGreaterThan(0)
  })
  it('does not mistake a field index for nesting depth', () => {
    const definition = emptyDefinition()
    definition.fields = Array.from({ length: 40 }, (_, i) => ({ id: `field_${i}`, kind: 'text', label: `Field ${i}` }))
    expect(definitionShapeIssues(definition)).toEqual([])
    expect(validateDefinition(definition)).toEqual([])
  })
})
describe('form calculation parser', () => {
  it('respects precedence, safe functions, precision and repeaters', () => {
    expect(calculate('round(2 + 3 * 1.15, 2)', {})).toBe(5.45)
    expect(calculate('sum([items.amount]) - min(5, 3)', { items: [{ amount: 7 }, { amount: 4 }] })).toBe(8)
    expect(calculate('if([qty] >= 10, 5, 0)', { qty: 11 })).toBe(5)
    expect(expressionReferences('[one] + sum([rows.two])')).toEqual(['one', 'rows.two'])
  })
  it.each(['globalThis.process.exit()', 'eval(1)', '[qty];alert(1)', '1 / 0', 'round(1, 100)', '1 2', 'constructor(1)'])('rejects unsafe or invalid expression %s', source => {
    expect(() => calculate(source, {})).toThrow()
  })
})
describe('form definition and submission evaluation', () => {
  it('cleans hidden answers, overrides forged totals and validates active requirements', () => {
    const definition = example()
    expect(validateDefinition(definition)).toEqual([])
    const result = validateAnswers(definition, { quantity: 3, total: 0, reason: 'must disappear' })
    expect(result.answers).toEqual({ quantity: 3, price: 2.5, total: 7.5 })
    expect(result.issues).toEqual([])
    expect(result.matchedRules).toEqual(['hide'])
    expect(validateAnswers(definition, { quantity: 12 }).issues.some(i => i.field === 'reason')).toBe(true)
    expect(validateAnswers(definition, {}, { partial: true }).issues).toEqual([])
  })
  it('rejects unknown fields and validates structured repeated answers without flattening', () => {
    const definition = { ...emptyDefinition(), fields: [{ id: 'rows', kind: 'repeater', label: 'Items', children: [{ id: 'email', kind: 'email', label: 'Email', required: true }] }] }
    const result = validateAnswers(definition, { rows: [{ email: 'wrong' }], admin: true })
    expect(result.issues.map(i => i.path)).toEqual(['admin', 'rows.0.email'])
    expect(validateAnswers(definition, { rows: [{ email: 'hello@example.com' }] }).answers.rows).toEqual([{ email: 'hello@example.com' }])
  })
  it('rejects calculation and rule cycles, invalid references and bad defaults', () => {
    const definition = example()
    definition.fields[0].kind = 'calculated'; definition.fields[0].expression = '[total]'
    expect(validateDefinition(definition).some(i => i.message.includes('Circular'))).toBe(true)
    definition.fields[0] = { id: 'quantity', kind: 'number', label: 'Quantity', defaultValue: 'wrong' }
    definition.fields[2].expression = '[missing]'
    expect(validateDefinition(definition).some(i => i.message.includes('Invalid default'))).toBe(true)
    expect(validateDefinition(definition).some(i => i.message.includes('missing'))).toBe(true)
  })
  it('removes section answers before dependent calculations', () => {
    const definition: FormDefinition = { ...emptyDefinition(), fields: [
      { id: 'show', kind: 'checkbox', label: 'Show' },
      { id: 'section', kind: 'section', label: 'Extra', children: [{ id: 'extra', kind: 'number', label: 'Extra' }] },
      { id: 'total', kind: 'calculated', label: 'Total', expression: '10 + [extra]' },
    ], rules: [{ id: 'hide', name: 'Hide extras', when: { field: 'show', operator: 'equals', value: false }, effects: [{ kind: 'visible', target: 'section', value: false }] }] }
    expect(evaluateForm(definition, { show: false, extra: 50 }).answers).toEqual({ show: false, total: 10 })
  })
  it('keeps date-only values stable across DST and enforces timezone-relative windows', () => {
    const field = { id: 'date', label: 'Visit', kind: 'date', date: { timezone: 'America/Chicago', minDaysFromToday: 0, excludedWeekdays: [0] } }
    expect(validateDate(field, '2026-03-09', new Date('2026-03-09T01:00:00Z'))).toEqual([])
    expect(validateDate(field, '2026-03-08', new Date('2026-03-09T01:00:00Z'))).toContain('This date is unavailable.')
    expect(validateDate(field, '2026-02-30', new Date())).toContain('Choose a valid calendar date.')
  })
  it('rejects missing wall times and resolves repeated times explicitly', () => {
    expect(() => wallTimeToInstant('2026-03-08T02:30', 'America/Chicago')).toThrow('does not exist')
    expect(() => wallTimeToInstant('2026-11-01T01:30', 'America/Chicago')).toThrow('occurs twice')
    expect(wallTimeToInstant('2026-11-01T01:30', 'America/Chicago', 'earlier')).toBe('2026-11-01T06:30:00.000Z')
    expect(wallTimeToInstant('2026-11-01T01:30', 'America/Chicago', 'later')).toBe('2026-11-01T07:30:00.000Z')
  })
})
