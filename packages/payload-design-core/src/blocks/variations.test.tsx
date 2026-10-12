import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyVariation, effectiveStyles, resetLayoutStyles } from './variations'
import { listBlockDefinitions } from './registry'
import {
  createContentNode,
  duplicateContent,
  validateContentLayout,
  walkContent,
} from '../content/model'
import { ContentRenderer } from '../content/ContentRenderer'
import { toTemplateBlock, templateBlockValue, toShellBlock, shellBlockValue } from './adapters'

describe('block variations', () => {
  it('preserves authored values and IDs through every layout and storage adapter', () => {
    for (const definition of listBlockDefinitions().filter((item) => item.variations?.length)) {
      let node = createContentNode(definition.type)
      const custom = createContentNode('paragraph')
      custom.text = 'Custom content stays'
      if (definition.container)
        node.children = [...(node.children ?? []), { ...custom, role: 'extra' }]
      node.styles = { desktop: { color: '#123456', padding: '19px' } }
      const original = structuredClone(node)
      for (const variation of definition.variations ?? []) {
        node = applyVariation(node, variation.id)
        expect(
          validateContentLayout({ version: 1, nodes: [node] }),
          `${definition.type}/${variation.id}`,
        ).toBe(true)
        expect(walkContent([node]).map((item) => item.id)).toEqual(
          walkContent([original]).map((item) => item.id),
        )
        expect(node.children).toEqual(original.children)
        expect(node.styles).toEqual(original.styles)
        expect(templateBlockValue(toTemplateBlock(node))).toEqual(node)
        expect(shellBlockValue(toShellBlock(node))).toEqual(node)
        expect(renderToStaticMarkup(<ContentRenderer nodes={[node]} />)).toContain(
          `data-variation="${variation.id}"`,
        )
      }
      const copy = duplicateContent(node)
      expect(
        walkContent([copy]).every((item) => !walkContent([node]).some((old) => old.id === item.id)),
      ).toBe(true)
      expect(copy.variation).toEqual(node.variation)
    }
  })
  it('does not restyle legacy nodes and only resets layout overrides', () => {
    const node: ReturnType<typeof createContentNode> = {
      ...createContentNode('hero'),
      variation: undefined,
      styles: { desktop: { padding: '19px', color: '#123456' } },
    }
    expect(effectiveStyles(node).desktop).toEqual(node.styles.desktop)
    expect(resetLayoutStyles(node)?.desktop).toEqual({ color: '#123456' })
    expect(renderToStaticMarkup(<ContentRenderer nodes={[node]} />)).not.toContain(
      'class="block-composition"',
    )
  })
  it('validates and scopes responsive target styles', () => {
    const node = createContentNode('hero')
    node.targetStyles = { container: { desktop: { padding: '18px' }, mobile: { padding: '4px' } } }
    expect(validateContentLayout({ version: 1, nodes: [node] })).toBe(true)
    const html = renderToStaticMarkup(<ContentRenderer nodes={[node]} />)
    expect(html).toContain('> .block-composition > .block-content{padding:18px}')
    expect(html).toContain('> .block-composition > .block-content{padding:4px}')
    node.targetStyles.container.desktop = { color: 'red;position:fixed' }
    expect(validateContentLayout({ version: 1, nodes: [node] })).not.toBe(true)
  })
})
