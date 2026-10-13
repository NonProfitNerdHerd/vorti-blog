import { describe, expect, it } from 'vitest'
import { cloneFields, duplicateFormField } from './clone'
import { emptyDefinition, type FormField } from './model'
import { exportForm, importForm } from './transfer'
import { validateDefinition } from './engine'

const option = (id: string) => ({ id, label: id, value: id })
describe('safe field copying', () => {
  it('remaps scoped choice defaults without rewriting literal text or colliding field IDs', () => {
    const source: FormField[] = [{ id: 'same', kind: 'text', label: 'Literal', defaultValue: 'same' },
      { id: 'one', kind: 'select', label: 'One', options: [option('same')], defaultValue: 'same' },
      { id: 'two', kind: 'select', label: 'Two', options: [option('same')], defaultValue: 'same' }]
    const copy = cloneFields(source)
    expect(copy.fields[0].defaultValue).toBe('same')
    expect(copy.fields[1].defaultValue).toBe(copy.fields[1].options![0].id)
    expect(copy.fields[2].defaultValue).toBe(copy.fields[2].options![0].id)
    expect(new Set([copy.fields[0].id, copy.fields[1].defaultValue, copy.fields[2].defaultValue]).size).toBe(3)
    expect(source[1].options![0].id).toBe('same')
  })
  it('preserves nested repeater and matrix defaults with fresh row, option, and field IDs', () => {
    const source: FormField[] = [{ id: 'items', kind: 'repeater', label: 'Items', defaultValue: [{ label: 'yes', choice: ['yes'], matrix: { yes: 'yes' } }], children: [
      { id: 'label', kind: 'text', label: 'Label' }, { id: 'choice', kind: 'multiSelect', label: 'Choice', options: [option('yes')] },
      { id: 'matrix', kind: 'likert', label: 'Matrix', options: [option('yes')], rows: [option('yes')] },
    ] }]
    const copy = cloneFields(source), [label, choice, matrix] = copy.fields[0].children!
    expect(copy.fields[0].defaultValue).toEqual([{ [label.id]: 'yes', [choice.id]: [choice.options![0].id], [matrix.id]: { [matrix.rows![0].id]: matrix.options![0].id } }])
    expect(matrix.rows![0].id).not.toBe(matrix.options![0].id)
  })
  it('duplicates adjacent to the original and remaps internal calculations and effects, keeping external dependencies', () => {
    const definition = emptyDefinition()
    definition.fields = [{ id: 'external', kind: 'number', label: 'Tax', defaultValue: 2 }, { id: 'outer', kind: 'section', label: 'Outer', children: [
      { id: 'group', kind: 'section', label: 'Group', children: [
        { id: 'qty', kind: 'number', label: 'Quantity', defaultValue: 1 },
        { id: 'sum', kind: 'calculated', label: 'Total', expression: '[qty] * [external]' },
        { id: 'choice', kind: 'select', label: 'Choice', options: [option('a'), option('b')], defaultValue: 'a' },
      ] }, { id: 'after', kind: 'text', label: 'After' },
    ] }]
    definition.actions = [{ id: 'notify', kind: 'localWebhook', name: 'Notify', config: {} }]
    definition.rules = [{ id: 'setchoice', name: 'Set choice', when: { field: 'qty', operator: 'gt', value: 2 }, effects: [{ kind: 'set', target: 'choice', value: 'b' }, { kind: 'action', target: 'notify' }] }]
    const before = structuredClone(definition), copy = duplicateFormField(definition, 'group')
    expect(definition).toEqual(before)
    expect(copy.definition.fields[1].children!.map(field => field.id)).toEqual(['group', copy.selected, 'after'])
    const [qty, sum, choice] = copy.definition.fields[1].children![1].children!
    expect(sum.expression).toBe(`[${qty.id}] * [external]`)
    expect(copy.definition.rules[1].when).toEqual({ field: qty.id, operator: 'gt', value: 2 })
    expect(copy.definition.rules[1].effects).toEqual([{ kind: 'set', target: choice.id, value: choice.options![1].id }])
    expect(validateDefinition(copy.definition)).toEqual([])
  })
  it('imports complete definitions with remapped set values and literal content intact', () => {
    const definition = emptyDefinition()
    definition.fields = [{ id: 'trigger', kind: 'text', label: 'Trigger', defaultValue: 'choice' }, { id: 'choice', kind: 'select', label: 'Choice', options: [option('a'), option('b')], defaultValue: 'a' }]
    definition.rules = [{ id: 'choose', name: 'Choose', when: { field: 'trigger', operator: 'equals', value: 'choice' }, effects: [{ kind: 'set', target: 'choice', value: 'b' }] }]
    const imported = importForm(exportForm('Test', definition)).definition
    expect(imported.fields[0].defaultValue).toBe('choice')
    expect(imported.rules[0].when).toEqual({ field: imported.fields[0].id, operator: 'equals', value: 'choice' })
    expect(imported.rules[0].effects[0]).toEqual({ kind: 'set', target: imported.fields[1].id, value: imported.fields[1].options![1].id })
    expect(validateDefinition(imported)).toEqual([])
  })
  it('does not redirect the original journey when copying a destination step', () => {
    const definition = emptyDefinition()
    definition.fields = [{ id: 'choose', kind: 'checkbox', label: 'Choose' }, { id: 'destination', kind: 'step', label: 'Destination', children: [] }]
    definition.rules = [{ id: 'route', name: 'Journey', when: { field: 'choose', operator: 'equals', value: true }, effects: [{ kind: 'route', target: 'destination' }] }]
    const copy = duplicateFormField(definition, 'destination')
    expect(copy.definition.rules).toEqual(definition.rules)
    const imported = importForm(exportForm('Journey', definition)).definition
    expect(imported.rules[0].effects).toEqual([{ kind: 'route', target: imported.fields[1].id }])
  })
})
