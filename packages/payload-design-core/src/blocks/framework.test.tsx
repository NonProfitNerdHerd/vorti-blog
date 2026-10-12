import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createContentNode,
  validateContentLayout,
  duplicateContent,
  resolveStyle,
} from '../content/model'
import { ContentRenderer } from '../content/ContentRenderer'
import { listBlockDefinitions, registerBlock } from './registry'
import { compileBlockCSS, conditionVisible, validatePresentation } from './presentation'
import { resolveBlocks } from './resolve'
import { toTemplateBlock, toShellBlock, templateBlockValue, shellBlockValue } from './adapters'
import { applyVariation, effectiveStyles } from './variations'
import { templateContentNodes } from '../content/template-adapter'
import type { Template } from '../types'

describe('registered block framework', () => {
  it('creates valid independently duplicable nodes for the complete catalog', () => {
    for (const definition of listBlockDefinitions().filter((item) => item.type !== 'column')) {
      const node = createContentNode(definition.type)
      expect(validateContentLayout({ version: 1, nodes: [node] }), definition.type).toBe(true)
      const copy = duplicateContent(node)
      expect(validateContentLayout({ version: 1, nodes: [node, copy] }), definition.type).toBe(true)
      expect(renderToStaticMarkup(<ContentRenderer nodes={[node]} viewport="desktop" />)).toContain(
        'content-block',
      )
    }
  })
  it('preserves registered data through template and shell adapters', () => {
    const node = createContentNode('hero')
    node.styles = { desktop: { padding: '24px' }, mobile: { padding: '8px' } }
    node.presentation = { css: '& strong { color: red; }' }
    const wrapped = toTemplateBlock(node)
    const template = { layout: [wrapped], sections: [] } as unknown as Template
    expect(templateContentNodes(template, {}, [], [])[0]).toEqual(node)
    expect(toShellBlock(node).block?.presentation).toEqual(node.presentation)
  })
  it('scopes rules and media queries while rejecting global escapes and executable values', () => {
    expect(
      compileBlockCSS(
        '&:hover { opacity: 0.5; } @media (max-width:640px) { & p { color: red; } }',
        '.block',
      ),
    ).toBe('.block:hover{opacity:0.5}@media (max-width:640px){.block p{color:red}}')
    for (const value of [
      'body { color: red }',
      '& + body { color: red }',
      '@import "evil";',
      'background:url(https://example.com)',
      '&{color:red}</style>',
      '&{color:red',
      '&{width:expression(alert(1))}',
      '&{\\62 ehavior:x}',
    ])
      expect(() => compileBlockCSS(value, '.block')).toThrow()
  })
  it('rejects invalid advanced options through the persisted content validator', () => {
    const node = createContentNode('paragraph')
    for (const presentation of [
      { attributes: { onclick: 'alert(1)' } },
      { link: { url: 'javascript:alert(1)' } },
      { hover: { color: 'red;}body{display:none' } },
      { condition: { match: 'all', rules: [{ field: 'password', operator: 'notEmpty' }] } },
    ])
      expect(validateContentLayout({ version: 1, nodes: [{ ...node, presentation }] })).not.toBe(
        true,
      )
  })
  it('filters content using dates, taxonomy membership and AND/OR groups', () => {
    expect(
      conditionVisible(
        { match: 'all', rules: [{ field: 'categories', operator: 'contains', value: '3' }] },
        { categories: [{ id: 3 }] },
      ),
    ).toBe(true)
    expect(
      conditionVisible(
        {
          match: 'any',
          rules: [
            { field: 'title', operator: 'empty' },
            { field: 'slug', operator: 'equals', value: 'example' },
          ],
        },
        { title: 'Hello', slug: 'example' },
      ),
    ).toBe(true)
    expect(
      conditionVisible(
        { match: 'all', rules: [], end: '2026-01-01T00:00:00Z' },
        {},
        Date.parse('2026-01-01T00:00:00Z'),
      ),
    ).toBe(false)
  })
  it('resolves only allowed bindings, active headings and server listings', async () => {
    const heading = { ...createContentNode('heading'), text: 'Visible heading' }
    const hidden = {
      ...createContentNode('heading'),
      text: 'Hidden heading',
      presentation: {
        condition: {
          match: 'all' as const,
          rules: [] as import('./presentation').Rule[],
          end: '2020-01-01T00:00:00Z',
        },
      },
    }
    const bound = { ...createContentNode('text'), bindings: { text: 'title' } }
    const nodes = await resolveBlocks(
      [
        heading,
        hidden,
        bound,
        createContentNode('tableOfContents'),
        createContentNode('postListing'),
      ],
      {
        document: { title: 'Document title' },
        list: async () => ({
          results: [{ title: 'Public post', url: '/posts/public' }],
          page: 1,
          totalPages: 1,
        }),
      },
    )
    expect(nodes).toHaveLength(4)
    expect(nodes[1].props?.text).toBe('Document title')
    expect(nodes[2].props?.headings).toEqual([
      { id: `heading-${heading.id}`, text: 'Visible heading', level: 2 },
    ])
    expect(nodes[3].props?.results).toHaveLength(1)
  })
  it('uses one registration for custom rendering and preserves unknown data', () => {
    registerBlock({
      type: 'testBadge',
      version: 1,
      label: 'Badge',
      icon: '★',
      description: 'Example',
      category: 'Text',
      keywords: [],
      contexts: ['content', 'template', 'header', 'footer'],
      fields: [],
      controls: ['layout'],
      variations: [
        { id: 'plain', label: 'Plain', thumbnail: 'stack' },
        {
          id: 'framed',
          label: 'Framed',
          thumbnail: 'stack',
          styles: { desktop: { padding: '16px' } },
        },
      ],
      targets: [{ id: 'label', label: 'Label', selector: '.badge-label' }],
      render: () => <mark className="badge-label">Custom badge</mark>,
    })
    expect(
      renderToStaticMarkup(<ContentRenderer nodes={[createContentNode('testBadge')]} />),
    ).toContain('Custom badge')
    const badge = applyVariation(createContentNode('testBadge'), 'framed')
    badge.targetStyles = { label: { desktop: { color: '#123456' } } }
    expect(effectiveStyles(badge).desktop?.padding).toBe('16px')
    expect(templateBlockValue(toTemplateBlock(badge))).toEqual(badge)
    expect(shellBlockValue(toShellBlock(badge))).toEqual(badge)
    expect(validateContentLayout({ version: 1, nodes: [badge] })).toBe(true)
    expect(renderToStaticMarkup(<ContentRenderer nodes={[badge]} />)).toContain(
      '.badge-label{color:#123456}',
    )
    const unknown = { id: 'missing', kind: 'missing-extension', props: { retained: true } }
    expect(validateContentLayout({ version: 1, nodes: [unknown] })).toBe(true)
    expect(renderToStaticMarkup(<ContentRenderer nodes={[unknown]} />)).toContain(
      'saved data is retained',
    )
    expect(
      resolveStyle({ desktop: { padding: '24px' }, tablet: { padding: '12px' } }, 'mobile').padding,
    ).toBe('12px')
  })
  it('assigns different stable anchors to Lexical headings', async () => {
    const node = createContentNode('richText')
    node.richText = {
      root: {
        type: 'root',
        version: 1,
        children: ['First', 'Second'].map((text) => ({
          type: 'heading',
          tag: 'h2',
          version: 1,
          children: [{ type: 'text', text, version: 1, format: 0 }],
        })),
      },
    }
    const resolved = await resolveBlocks([node, createContentNode('tableOfContents')], {
      document: {},
    })
    expect(resolved[1].props?.headings).toEqual([
      { id: `heading-${node.id}-1`, text: 'First', level: 2 },
      { id: `heading-${node.id}-2`, text: 'Second', level: 2 },
    ])
    const html = renderToStaticMarkup(<ContentRenderer nodes={resolved} />)
    expect(html).toContain(`id="heading-${node.id}-1"`)
    expect(html).toContain(`id="heading-${node.id}-2"`)
  })
  it('exposes declared template values on registered blocks without freeform binding permission', () => {
    const node = { ...createContentNode('text'), bindings: { text: 'templateValues.intro' } }
    expect(validateContentLayout({ version: 1, nodes: [node] })).not.toBe(true)
    expect(validateContentLayout({ version: 1, nodes: [node] }, ['templateValues.intro'])).toBe(
      true,
    )
    const template = {
      layout: [toTemplateBlock(node)],
      sections: [],
      customFields: [
        {
          id: 'intro',
          label: 'Introduction',
          fieldType: 'longText',
          helpText: 'Write the introduction',
        },
      ],
    } as unknown as Template
    const result = templateContentNodes(
      template,
      { templateValues: { intro: 'Bound content' } },
      [],
      [],
    )
    expect(result[0].props?.text).toBe('Bound content')
    expect(result[0].fields?.[0].binding?.path).toBe('templateValues.intro')
    expect(result[0].fields?.[0].binding?.helpText).toBe('Write the introduction')
  })
  it('rejects malformed presentation values without throwing', () => {
    for (const value of [
      { hidden: 'mobile' },
      { attributes: [] as unknown[] },
      { motion: 4 },
      { css: {} },
      { condition: { match: 'all', rules: [null] as unknown[] } },
    ])
      expect(validatePresentation(value as never)).toBeTruthy()
  })
})
