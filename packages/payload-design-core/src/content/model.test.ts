import { describe, expect, it } from 'vitest'
import {
  createContentNode,
  duplicateContent,
  insertContent,
  moveContent,
  resolveStyle,
  validateContentLayout,
  type ContentNode,
} from './model'
import { templateContentNodes } from './template-adapter'

describe('content document operations', () => {
  const heading: ContentNode = { id: 'heading', kind: 'heading', text: 'Hello' }
  const paragraph: ContentNode = { id: 'paragraph', kind: 'paragraph', text: 'Text' }
  it('inserts and moves at an exact sibling position, including across containers', () => {
    const group: ContentNode = { id: 'group', kind: 'group', children: [paragraph] }
    const nodes = moveContent([heading, group], 'heading', 'group', 'paragraph')
    expect(nodes).toEqual([{ ...group, children: [heading, paragraph] }])
    expect(moveContent(nodes, 'heading', 'root', 'group')).toEqual([heading, group])
    expect(insertContent([heading], paragraph, 'root', 'heading')).toEqual([paragraph, heading])
  })
  it('does not lose blocks on invalid targets or create cycles', () => {
    const nodes: ContentNode[] = [
      {
        id: 'group',
        kind: 'group',
        children: [{ id: 'inner', kind: 'group', children: [heading] }],
      },
    ]
    expect(moveContent(nodes, 'group', 'inner')).toBe(nodes)
    expect(moveContent(nodes, 'heading', 'missing')).toBe(nodes)
    expect(moveContent(nodes, 'inner', 'heading')).toBe(nodes)
    expect(moveContent([heading, createContentNode('columns')], 'heading', 'heading')).toEqual([
      heading,
      expect.anything(),
    ])
  })
  it('enforces column nesting and duplicates descendant IDs', () => {
    const columns = createContentNode('columns')
    const copy = duplicateContent(columns)
    expect(copy.id).not.toBe(columns.id)
    expect(copy.children?.[0].id).not.toBe(columns.children?.[0].id)
    expect(validateContentLayout({ version: 1, nodes: [columns] })).toBe(true)
    expect(
      validateContentLayout({ version: 1, nodes: [{ ...columns, children: [heading] }] }),
    ).toMatch(/Columns/)
  })
  it('rejects unsafe URLs, styles, duplicate IDs and template bindings', () => {
    expect(validateContentLayout({ version: 1, nodes: [heading, { ...heading }] })).toMatch(
      /unique/,
    )
    expect(
      validateContentLayout({ version: 1, nodes: [{ ...heading, binding: { path: 'title' } }] }),
    ).toMatch(/bindings/)
    expect(
      validateContentLayout({
        version: 1,
        nodes: [{ ...heading, styles: { desktop: { backgroundColor: 'red;display:none' } } }],
      }),
    ).toMatch(/Invalid/)
    expect(
      validateContentLayout({ version: 1, nodes: [{ ...heading, url: 'javascript:alert(1)' }] }),
    ).toMatch(/URL/)
  })
  it('inherits responsive styles without losing desktop values', () => {
    expect(
      resolveStyle(
        {
          desktop: { padding: '24px', color: '#111' },
          tablet: { padding: '16px' },
          mobile: { margin: '0' },
        },
        'mobile',
      ),
    ).toEqual({ padding: '16px', color: '#111', margin: '0' })
  })
  it('resolves template field bindings while keeping static elements uneditable', () => {
    const nodes = templateContentNodes(
      {
        id: 1,
        name: 'Template',
        slug: 'template',
        status: 'published',
        allowedCollections: ['posts'],
        sections: [],
        layout: [
          {
            id: 'fixed',
            type: 'field',
            fieldType: 'shortText',
            label: 'Fixed',
            content: { source: 'static', value: 'Fixed' },
          },
          {
            id: 'intro',
            type: 'field',
            fieldType: 'longText',
            label: 'Intro',
            content: { source: 'customField', fieldId: 'body' },
          },
        ],
      },
      { templateValues: { body: 'Editable' } },
      [],
      [],
    )
    expect(nodes[0].binding).toBeUndefined()
    expect(nodes[1].binding?.path).toBe('templateValues.body')
    expect(nodes[1].text).toBe('Editable')
  })
})
