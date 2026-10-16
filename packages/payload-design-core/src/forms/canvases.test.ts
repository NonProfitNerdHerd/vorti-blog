import { describe, expect, it } from 'vitest'
import { canvasItems, deletionPlan, movePart, organizeCanvases, organizeIssue, owningCanvas } from './canvases'
import { emptyDefinition, flattenFields } from './model'
import { duplicateFormField } from './clone'

describe('Form canvases', () => {
  it('projects legacy fields without mutation and organizes without changing IDs, mode or references', () => {
    const definition = emptyDefinition()
    definition.fields = [{ id: 'name', kind: 'text', label: 'Name', width: 6 }, { id: 'group', kind: 'section', label: 'Group', children: [{ id: 'email', kind: 'email', label: 'Email' }] }]
    const original = structuredClone(definition)
    expect(canvasItems(definition.fields)[0].children).toEqual(definition.fields)
    expect(definition).toEqual(original)
    const organized = organizeCanvases(definition)
    expect(organized.fields[0].kind).toBe('step')
    expect(organized.fields[0].children).toEqual(original.fields)
    expect(organized.mode).toBe(original.mode)
    expect(owningCanvas(organized.fields, 'email')).toBe(organized.fields[0].id)
  })
  it('moves parts across canvases without changing identifiers and rejects cycles and nested canvases', () => {
    const fields = [{ id: 'a', kind: 'step', label: 'A', children: [{ id: 'group', kind: 'section', label: 'Group', children: [{ id: 'q', kind: 'text', label: 'Question' }] }] }, { id: 'b', kind: 'step', label: 'B', children: [] }]
    expect(movePart(fields, 'a', 'group')).toBe(fields)
    expect(movePart(fields, 'group', 'q')).toBe(fields)
    const moved = movePart(fields, 'q', 'b')
    expect(owningCanvas(moved, 'q')).toBe('b')
    expect(flattenFields(moved).filter(field => field.id === 'q')).toHaveLength(1)
    expect(movePart(fields, 'b', 'a').map(field => field.id)).toEqual(['b', 'a'])
  })
  it('does not silently reorganize mixed or nested Steps', () => {
    expect(organizeIssue([{ id: 'a', kind: 'step', label: 'A' }, { id: 'q', kind: 'text', label: 'Q' }])).toContain('mixes')
    expect(organizeIssue([{ id: 'g', kind: 'section', label: 'Group', children: [{ id: 'a', kind: 'step', label: 'A' }] }])).toContain('nested')
  })
  it('blocks external references and removes only rules local to the deleted subtree', () => {
    const definition = emptyDefinition()
    definition.fields = [{ id: 'a', kind: 'step', label: 'A', children: [{ id: 'q', kind: 'text', label: 'Q' }] }, { id: 'other', kind: 'text', label: 'Other' }]
    definition.rules = [{ id: 'local', name: 'Local behavior', when: { field: 'other', operator: 'notEmpty' }, effects: [{ kind: 'required', target: 'q', value: true }] }, { id: 'external', name: 'Retained behavior', when: { field: 'q', operator: 'notEmpty' }, effects: [{ kind: 'visible', target: 'other', value: true }] }]
    definition.actions = [{ id: 'mail', kind: 'email', name: 'Notification', config: { to: '{{q}}' } }]
    expect(deletionPlan(definition, 'a').blockers).toEqual(['Logic: Retained behavior', 'Action: Notification'])
    definition.rules.pop(); definition.actions = []
    const removed = deletionPlan(definition, 'a')
    expect(removed.blockers).toEqual([])
    expect(removed.definition.rules).toEqual([])
    expect(removed.definition.fields.map(field => field.id)).toEqual(['other'])
  })
  it('duplicates a canvas with fresh IDs and leaves global routing alone', () => {
    const definition = emptyDefinition()
    definition.fields = [{ id: 'a', kind: 'step', label: 'A', children: [{ id: 'q', kind: 'text', label: 'Q' }] }]
    definition.rules = [{ id: 'route', name: 'Route', when: { all: [] }, effects: [{ kind: 'route', target: 'a' }] }]
    const copy = duplicateFormField(definition, 'a').definition
    expect(copy.fields).toHaveLength(2)
    expect(copy.fields[1].children?.[0].id).not.toBe('q')
    expect(copy.rules).toEqual(definition.rules)
  })
})
