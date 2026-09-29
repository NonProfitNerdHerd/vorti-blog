// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteShellNode } from '../site-shell'
import { insertSiteShellNode, moveSiteShellNodeTo, removeSiteShellNode } from '../site-shell-tree'
import { SiteShellBuilder, SiteTemplateBuilder } from './SiteShellBuilder'

const payloadForm = vi.hoisted(() => ({ fields: new Map<string, { value: unknown; setValue: ReturnType<typeof vi.fn> }>() }))
vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ id: 42 }),
  useField: ({ path }: { path: string }) => payloadForm.fields.get(path) ?? { value: undefined, setValue: vi.fn() },
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => children,
  KeyboardSensor: function KeyboardSensor() {}, PointerSensor: function PointerSensor() {}, pointerWithin: vi.fn(),
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn() }), useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }), useSensor: vi.fn(() => ({})), useSensors: vi.fn(() => []),
}))
vi.mock('@dnd-kit/sortable', () => ({ sortableKeyboardCoordinates: vi.fn() }))

const field = (value: unknown) => ({ value, setValue: vi.fn() })

beforeEach(() => {
  payloadForm.fields = new Map([
    ['name', field('Default Website Template')], ['slug', field('default-website-template')], ['description', field('Default shell')],
    ['header.layout', field([])], ['header.settings', field({ widthMode: 'contained' })], ['footer.layout', field([])], ['footer.settings', field({ widthMode: 'full' })],
    ['typography', field({})], ['colors', field({})], ['buttons', field({})], ['dimensions', field({})], ['mobile', field({})], ['additionalCSS', field('')],
    ['assignment.mode', field('default')], ['assignment.priority', field(0)],
  ])
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ defaultSiteTemplate: 42 }), { status: 200 })))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('SiteShellBuilder', () => {
  it('loads Header and Footer from the same builder with filtered libraries', () => {
    const { rerender } = render(<SiteShellBuilder region="header" />)
    expect(screen.getByTestId('site-shell-header')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mobile Menu Toggle' })).toBeTruthy()
    rerender(<SiteShellBuilder region="footer" />)
    expect(screen.getByRole('button', { name: 'Current Year' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copyright' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })

  it('inserts layout and dynamic Site Settings elements without copying identity values', () => {
    render(<SiteShellBuilder region="header" />)
    fireEvent.click(screen.getByRole('button', { name: 'Container' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(payloadForm.fields.get('header.layout')!.setValue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ type: 'layout', layout: 'container' })]))
    cleanup()
    payloadForm.fields.set('header.layout', field([]))
    render(<SiteShellBuilder region="header" />)
    fireEvent.click(screen.getByRole('button', { name: 'Site Logo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(payloadForm.fields.get('header.layout')!.setValue).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ type: 'element', element: 'logo', props: expect.objectContaining({ source: 'siteSettings.logo' }) })]))
  })

  it('stores Navigation source and inspector presentation controls', () => {
    render(<SiteShellBuilder region="header" />)
    fireEvent.click(screen.getByRole('button', { name: 'Navigation Menu' }))
    fireEvent.change(screen.getByLabelText('Menu Source'), { target: { value: 'footer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(payloadForm.fields.get('header.layout')!.setValue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ element: 'navigation', props: expect.objectContaining({ menuSource: 'footer' }) })]))
  })

  it('stores responsive overrides and changes preview viewport without changing content schema', () => {
    render(<SiteShellBuilder region="header" />)
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Style' }))
    fireEvent.change(screen.getByLabelText('padding'), { target: { value: '24px' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))
    fireEvent.change(screen.getByLabelText('padding'), { target: { value: '12px' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(JSON.stringify(payloadForm.fields.get('header.layout')!.setValue.mock.calls.at(-1)?.[0])).toContain('"desktop":"24px"')
    expect(JSON.stringify(payloadForm.fields.get('header.layout')!.setValue.mock.calls.at(-1)?.[0])).toContain('"tablet":"12px"')
    expect(document.querySelector('[data-viewport="tablet"]')).toBeTruthy()
  })

  it('renders the dynamic Current Year preview', () => {
    payloadForm.fields.set('footer.layout', field([{ id: 'year', type: 'element', element: 'currentYear', props: { source: 'system.currentYear' } }]))
    render(<SiteShellBuilder region="footer" />)
    expect(screen.getByText(String(new Date().getFullYear()))).toBeTruthy()
  })

  it('supports nested insertion, reparenting, and deletion through shell tree operations', () => {
    const child: SiteShellNode = { id: 'logo', type: 'element', element: 'logo' }
    const initial: SiteShellNode[] = [{ id: 'row', type: 'layout', layout: 'row', children: [] }, { id: 'stack', type: 'layout', layout: 'stack', children: [] }]
    const inserted = insertSiteShellNode(initial, 'row', child)
    expect(JSON.stringify(inserted)).toContain('logo')
    const moved = moveSiteShellNodeTo(inserted, 'logo', 'stack')
    expect((moved[1] as Extract<SiteShellNode, { type: 'layout' }>).children).toEqual([child])
    expect(JSON.stringify(removeSiteShellNode(moved, 'logo'))).not.toContain('logo')
  })

  it('keeps layout labels in List View, removes them from the canvas, and can undo a removal', () => {
    const columns: SiteShellNode = { id: 'columns', type: 'layout', layout: 'columns', columns: [{ id: 'left', width: 70, children: [] }, { id: 'right', width: 30, children: [] }] }
    payloadForm.fields.set('footer.layout', field([columns]))
    const { rerender } = render(<SiteShellBuilder region="footer" />)
    expect(screen.queryByText('Footer Shell')).toBeNull()
    expect(screen.queryByText('Columns · 70 / 30')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'List View' }))
    expect(screen.getByText('Columns · 70 / 30')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Columns · 70 / 30' }))
    payloadForm.fields.set('footer.layout', { ...payloadForm.fields.get('footer.layout')!, value: [] })
    rerender(<SiteShellBuilder region="footer" />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo last change' }))
    expect(payloadForm.fields.get('footer.layout')!.setValue).toHaveBeenLastCalledWith([columns])
  })

  it('provides Overview, Header, Footer, Global Styles and supported Assignments tabs', async () => {
    render(<SiteTemplateBuilder />)
    expect(await screen.findByText('Current default Site Template')).toBeTruthy()
    for (const tab of ['Overview', 'Header', 'Footer', 'Global Styles', 'Assignments']) expect(screen.getByRole('tab', { name: tab })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Assignments' }))
    expect((screen.getByLabelText('Assignment Mode') as HTMLInputElement).value).toBe('default')
  })

  it('provides visual Global Styles sections while preserving advanced JSON and CSS editing', () => {
    render(<SiteTemplateBuilder />)
    fireEvent.click(screen.getByRole('tab', { name: 'Global Styles' }))
    for (const tab of ['Typography', 'Colors', 'Buttons', 'Dimensions', 'Mobile Defaults', 'Additional CSS']) expect(screen.getByRole('tab', { name: tab })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Body font'), { target: { value: 'Inter, sans-serif' } })
    expect(payloadForm.fields.get('typography')!.setValue).toHaveBeenCalledWith(expect.objectContaining({ bodyFont: 'Inter, sans-serif' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Additional CSS' }))
    fireEvent.change(screen.getByLabelText('Additional CSS'), { target: { value: '.site { color: red; }' } })
    expect(payloadForm.fields.get('additionalCSS')!.setValue).toHaveBeenCalledWith('.site { color: red; }')
  })
})
