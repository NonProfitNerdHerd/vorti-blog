import { describe, expect, it } from 'vitest'
import { columnPresets, createColumn, setColumnLayout } from './columns'
import { emptyDefinition, flattenFields } from './model'
import { validateDefinition } from './engine'
import { duplicateFormField } from './clone'
import { deletionPlan, movePart } from './canvases'

describe('Forms column layouts', () => {
  it('round trips every preset without losing fields or IDs, including legacy rows', () => {
    let value = emptyDefinition()
    value.fields = [{ id: 'canvas', kind: 'step', label: 'Canvas', children: [{ id: 'row', kind: 'row', label: 'Columns', children: [{ id: 'question', kind: 'text', label: 'Question' }] }] }]
    for (const weights of [...columnPresets, ...[...columnPresets].reverse()]) {
      const result = setColumnLayout(value, 'row', weights)
      expect(result.error).toBeUndefined()
      value = result.definition
      expect(validateDefinition(value)).toEqual([])
      expect(flattenFields(value.fields).filter(field => field.id === 'question')).toHaveLength(1)
      const row = flattenFields(value.fields).find(field => field.id === 'row')!
      expect(row.children?.map(child => child.layout?.kind === 'column' ? child.layout.weight : 0)).toEqual(weights)
    }
    const copy = duplicateFormField(value, 'row').definition
    expect(validateDefinition(copy)).toEqual([])
    expect(new Set(flattenFields(copy.fields).map(field => field.id)).size).toBe(flattenFields(copy.fields).length)
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  })
  it('preserves order on reduction and blocks references to disappearing columns', () => {
    const value = emptyDefinition(), columns = [createColumn(0, 50), createColumn(1, 50)]
    columns[0].children = [{ id: 'a', kind: 'text', label: 'A' }]
    columns[1].children = [{ id: 'b', kind: 'text', label: 'B' }]
    value.fields = [{ id: 'row', kind: 'row', label: 'Columns', layout: { kind: 'columns' }, children: columns }]
    value.rules = [{ id: 'rule', name: 'Visible column', when: { field: 'a', operator: 'notEmpty' }, effects: [{ kind: 'visible', target: columns[1].id, value: true }] }]
    expect(setColumnLayout(value, 'row', [100]).error).toContain('referenced')
    expect(deletionPlan(value, columns[1].id).blockers).not.toHaveLength(0)
    value.rules = []
    const reduced = setColumnLayout(value, 'row', [100]).definition
    expect(reduced.fields[0].children?.[0].children?.map(field => field.id)).toEqual(['a', 'b'])
    expect(deletionPlan(reduced, columns[0].id).blockers).toHaveLength(1)
    expect(movePart(value.fields, columns[0].id, 'root')).toBe(value.fields)
  })
  it('rejects forged metadata, orphan columns and nested full-page layouts', () => {
    const value = emptyDefinition()
    value.fields = [{ id: 'group', kind: 'section', label: 'Group', children: [{ id: 'row', kind: 'row', label: 'Columns', layout: { kind: 'columns', width: 'full' }, children: [createColumn(0, 100)] }] }]
    expect(validateDefinition(value).some(issue => issue.message.includes('Full Page'))).toBe(true)
    value.fields = [createColumn(0, 100)]
    expect(validateDefinition(value).some(issue => issue.message.includes('belong'))).toBe(true)
    value.fields[0].layout = { kind: 'column', weight: -1 }
    expect(validateDefinition(value)).not.toEqual([])
  })
})
