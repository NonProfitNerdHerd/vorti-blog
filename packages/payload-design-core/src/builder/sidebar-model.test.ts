import { describe, expect, it } from 'vitest'
import {
  contentSidebarNodes,
  templateSidebarNodes,
  shellSidebarNodes,
  outlineSummary,
  insertionTarget,
  duplicateBuilderNode,
} from './sidebar-model'
import { insertSiteShellNode, moveSiteShellNodeTo } from '../site-shell-tree'
import type { SiteShellNode } from '../site-shell'

const rich = {
  root: {
    children: [
      { type: 'heading', tag: 'h3', children: [{ type: 'text', text: 'Nested heading' }] },
      {
        type: 'list',
        children: [
          { type: 'listitem', children: [{ type: 'text', text: 'First item' }] },
          { type: 'listitem', children: [{ type: 'text', text: 'Second item' }] },
        ],
      },
    ],
  },
}
describe('sidebar adapters and document outline', () => {
  it('extracts Lexical headings and navigation-only list rows without double-counting', () => {
    const nodes = contentSidebarNodes([{ id: 'rich', kind: 'richText', richText: rich }])
    const summary = outlineSummary(nodes)
    expect(summary.words).toBe(6)
    expect(summary.minutes).toBe(1)
    expect(summary.headings).toEqual([
      expect.objectContaining({ heading: 3, text: 'Nested heading', ownerID: 'rich' }),
    ])
    expect(nodes[0].children?.filter((node) => node.kind === 'listitem')).toHaveLength(2)
  })
  it('counts plain headings, paragraphs and list items once', () => {
    expect(
      outlineSummary(
        contentSidebarNodes([
          { id: 'h', kind: 'heading', text: 'Two words', level: 1 },
          { id: 'list', kind: 'list', text: 'First item\nSecond item' },
        ]),
      ).words,
    ).toBe(6)
    expect(outlineSummary([])).toEqual({ headings: [], words: 0, minutes: 0 })
    expect(
      outlineSummary(
        contentSidebarNodes([
          { id: 'p', kind: 'paragraph', text: Array(201).fill('word').join(' ') },
        ]),
      ).minutes,
    ).toBe(2)
  })
  it('excludes template placeholders and dynamic document-field previews', () => {
    const nodes = templateSidebarNodes([
      {
        id: 'h',
        type: 'field',
        fieldType: 'shortText',
        label: 'Heading label',
        placeholder: 'Sample heading',
      },
      {
        id: 'p',
        type: 'field',
        fieldType: 'longText',
        label: 'Paragraph',
        content: { source: 'static', value: 'Actual template text' },
      },
    ])
    expect(outlineSummary(nodes).words).toBe(3)
    expect(outlineSummary(nodes).headings).toHaveLength(0)
  })
  it('reads shell Lexical content and excludes dynamic site identity placeholders', () => {
    expect(
      outlineSummary(
        shellSidebarNodes([
          { id: 'name', type: 'element', element: 'siteName' },
          { id: 'rich', type: 'element', element: 'richText', props: { lexical: rich } },
        ]),
      ).words,
    ).toBe(6)
  })
  it('inserts after selection, inside a selected container, or at root when selection is stale', () => {
    const nodes = contentSidebarNodes([
      { id: 'a', kind: 'paragraph' },
      { id: 'g', kind: 'group', children: [{ id: 'b', kind: 'paragraph' }] },
    ])
    expect(insertionTarget(nodes, 'a')).toEqual({ parent: 'root', before: 'g' })
    expect(insertionTarget(nodes, 'g')).toEqual({ parent: 'g' })
    expect(insertionTarget(nodes, 'b')).toEqual({ parent: 'g', before: undefined })
    expect(insertionTarget(nodes, 'deleted')).toEqual({ parent: 'root' })
  })
  it('duplicates nested IDs while retaining template custom-field references', () => {
    const node = {
      id: 'g',
      type: 'layout',
      children: [{ id: 'h', content: { source: 'customField', fieldId: 'shared' } }],
    }
    const copy = duplicateBuilderNode(node)
    expect(copy.id).not.toBe(node.id)
    expect(copy.children[0].id).not.toBe(node.children[0].id)
    expect(copy.children[0].content.fieldId).toBe('shared')
  })
})
describe('Site Shell positional movement', () => {
  const a: SiteShellNode = { id: 'a', type: 'element', element: 'text' }
  const b: SiteShellNode = { id: 'b', type: 'element', element: 'text' }
  const group: SiteShellNode = { id: 'g', type: 'layout', layout: 'container', children: [a, b] }
  it('inserts and moves at the requested sibling position', () => {
    expect(insertSiteShellNode([b], 'root', a, 'b')).toEqual([a, b])
    expect(moveSiteShellNodeTo([group], 'b', 'g', 'a')[0]).toEqual({ ...group, children: [b, a] })
    expect(moveSiteShellNodeTo([group], 'a', 'root', 'g')).toEqual([a, { ...group, children: [b] }])
  })
  it('keeps content intact on invalid, self, descendant and missing targets', () => {
    const columns: SiteShellNode = {
      id: 'cols',
      type: 'layout',
      layout: 'columns',
      columns: [{ id: 'col', width: 100, children: [group] }],
    }
    for (const target of ['missing', 'a', 'col', 'cols'])
      expect(moveSiteShellNodeTo([columns], 'cols', target)).toEqual([columns])
    expect(moveSiteShellNodeTo([group], 'a', 'missing')).toEqual([group])
    expect(moveSiteShellNodeTo([group], 'a', 'b')).toEqual([group])
  })
})
