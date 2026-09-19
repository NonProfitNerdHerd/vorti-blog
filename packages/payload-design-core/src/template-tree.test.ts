import { describe, expect, it } from 'vitest'
import { collectFieldIDs, moveTemplateNode, moveTemplateNodeTo, removeTemplateNode, updateTemplateNode } from './template-tree'
import type { TemplateNode } from './types'

const tree: TemplateNode[] = [{ id: 'columns', type: 'layout', layout: 'columns', columns: [
  { id: 'left', width: 60, children: [{ id: 'field-story', type: 'field', fieldType: 'richText', label: 'Main Story', required: true }] },
  { id: 'right', width: 40, children: [{ id: 'field-image', type: 'field', fieldType: 'image', label: 'Story Image' }] },
] }, { id: 'field-closing', type: 'field', fieldType: 'richText', label: 'Closing Message' }]

describe('Template layout tree', () => {
  it('keeps stable field identities through reorder, rename, and column moves', () => {
    const reordered = moveTemplateNode(tree, 'field-closing', -1)
    const renamed = updateTemplateNode(reordered, 'field-story', (node) => node.type === 'field' ? { ...node, label: 'Feature Story' } : node)
    const moved = moveTemplateNodeTo(renamed, 'field-story', 'right')
    expect(collectFieldIDs(moved).sort()).toEqual(['field-closing', 'field-image', 'field-story'])
    expect(JSON.stringify(moved)).toContain('Feature Story')
    expect(JSON.stringify(moved)).toContain('"id":"field-story"')
  })

  it('removes a field from the published tree without touching external stored values', () => {
    const values = { 'field-story': 'Preserved story', 'field-image': 12 }
    expect(collectFieldIDs(removeTemplateNode(tree, 'field-story'))).not.toContain('field-story')
    expect(values['field-story']).toBe('Preserved story')
  })
})
