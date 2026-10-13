import { expect, it } from 'vitest'
import { emptyDefinition } from './model'
import { exportForm, importForm } from './transfer'

it('excludes sensitive defaults, linked configuration and action-only rules without changing the source', () => {
  const definition = emptyDefinition()
  definition.fields = [{ id: 'people', kind: 'repeater', label: 'People', defaultValue: [{ salary: 123 }], children: [
    { id: 'salary', kind: 'number', label: 'Salary', sensitive: true, defaultValue: 456 },
  ] }, { id: 'name', kind: 'text', label: 'Name', prefill: { source: 'profile', key: 'displayName' } }]
  definition.actions = [{ id: 'send', name: 'Send', kind: 'email', config: { to: 'private@example.test', subject: 'Private' } }]
  definition.rules = [{ id: 'sendRule', name: 'Send', when: { field: 'name', operator: 'notEmpty' }, effects: [{ kind: 'action', target: 'send' }] }]
  definition.access.origins = ['https://private.example.test']
  const snapshot = structuredClone(definition)
  const portable = exportForm('Sample', definition)
  expect(portable.definition.fields[0].defaultValue).toBeUndefined()
  expect(portable.definition.fields[0].children![0].defaultValue).toBeUndefined()
  expect(portable.definition.fields[1].prefill).toBeUndefined()
  expect(portable.definition.rules).toEqual([])
  expect(portable.definition.actions).toEqual([])
  expect(portable.definition.access.origins).toEqual([])
  expect(importForm(portable).definition.fields[0].id).not.toBe('people')
  expect(definition).toEqual(snapshot)
})

it('rejects unsupported and malformed imports without applying partial data', () => {
  const invalid: unknown[] = [null, { format: 'vorti-form', version: 2 }, { format: 'vorti-form', version: 1, definition: { fields: null as unknown } }]
  for (const input of invalid) expect(() => importForm(input)).toThrow()
  const definition = emptyDefinition()
  definition.fields = [{ id: 'bad', kind: 'calculated', label: 'Bad', expression: '[missing] + 1' }]
  expect(() => importForm({ format: 'vorti-form', version: 1, definition })).toThrow()
})
