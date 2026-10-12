// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { listViews, viewBlockKind, isViewPlacement } from './model'
import { getBlockDefinition } from '../blocks/registry'
import { createContentNode, getContentLibrary, validateContentLayout } from '../content/model'
import {
  toTemplateBlock,
  toShellBlock,
  templateBlockValue,
  shellBlockValue,
} from '../blocks/adapters'
import { resolveBlocks } from '../blocks/resolve'
import { ViewPlacementSetup } from './ViewPlacementSetup'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('named dynamic display placements', () => {
  it('exposes every registered display in every editor and retains its reference through adapters', () => {
    for (const view of listViews()) {
      const kind = viewBlockKind(view.key),
        node = createContentNode(kind)
      node.props = { viewID: '42' }
      expect(getContentLibrary().find((item) => item.kind === kind)?.label).toBe(view.label)
      expect(getBlockDefinition(kind)?.contexts).toEqual([
        'content',
        'template',
        'header',
        'footer',
      ])
      expect(isViewPlacement(kind)).toBe(true)
      expect(validateContentLayout({ version: 1, nodes: [node] })).toBe(true)
      expect(templateBlockValue(toTemplateBlock(node))?.props?.viewID).toBe('42')
      expect(shellBlockValue(toShellBlock(node))?.props?.viewID).toBe('42')
      node.styles = { desktop: { color: 'red' } }
      expect(validateContentLayout({ version: 1, nodes: [node] })).not.toBe(true)
    }
  })
  it('resolves central published data for named placements without mutating their stored values', async () => {
    const node = createContentNode(viewBlockKind('event-month'))
    node.props = { viewID: '42' }
    const view = vi.fn(async () => ({ items: [{ title: 'An event' }] }))
    const result = await resolveBlocks([node], { document: {}, view })
    expect(view).toHaveBeenCalledWith('42')
    expect(result[0].props?.resolvedView).toEqual({ items: [{ title: 'An event' }] })
    expect(node.props.resolvedView).toBeUndefined()
  })
  it('creates the chosen layout and filters as a central view, then attaches only its ID', async () => {
    const node = createContentNode(viewBlockKind('grid-7'))
    node.props = {
      viewSetup: {
        name: 'Arts stories',
        configuration: {
          version: 1,
          layout: 'grid-7',
          query: {
            source: 'posts',
            rules: [{ field: 'tags', operator: 'all', values: ['3', '4'] }],
          },
        },
      },
    }
    const fetch = vi.fn(async (_url: string, _options: { body: string }) => ({
      ok: true,
      json: async () => ({ doc: { id: 42 } }),
    }))
    vi.stubGlobal('fetch', fetch)
    const change = vi.fn()
    render(<ViewPlacementSetup node={node} onChange={change} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create view and use here' }))
    await waitFor(() => expect(change).toHaveBeenCalledWith({ props: { viewID: '42' } }))
    expect(JSON.parse(fetch.mock.calls[0][1].body).configuration.query.rules[0].values).toEqual([
      '3',
      '4',
    ])
    expect(JSON.parse(fetch.mock.calls[0][1].body).configuration.layout).toBe('grid-7')
  })
  it('keeps setup and reports denied creation without attaching a broken reference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ errors: [{ message: 'Forbidden' }] }),
      })),
    )
    const change = vi.fn()
    render(
      <ViewPlacementSetup
        node={createContentNode(viewBlockKind('event-month'))}
        onChange={change}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create view and use here' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Forbidden')
    expect(change).not.toHaveBeenCalled()
  })
  it('retains a matching choice made before selecting taxonomy values', () => {
    const change = vi.fn()
    render(
      <ViewPlacementSetup node={createContentNode(viewBlockKind('grid-1'))} onChange={change} />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag matching' }), {
      target: { value: 'exclude' },
    })
    expect(change.mock.calls[0][0].props.viewSetup.configuration.query.rules).toEqual([
      { field: 'tags', operator: 'exclude', values: [] },
    ])
  })
})
