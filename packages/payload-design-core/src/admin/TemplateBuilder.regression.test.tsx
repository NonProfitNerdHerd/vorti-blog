// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateNode } from '../types'
import { TemplateBuilder } from './TemplateBuilder'

const payloadForm = vi.hoisted(() => ({
  fields: new Map<string, { setValue: ReturnType<typeof vi.fn>; value: unknown }>(),
  submit: vi.fn(),
}))

vi.mock('@payloadcms/ui', () => ({
  useDocumentInfo: () => ({ hasPublishedDoc: true, id: undefined as string | number | undefined }),
  useField: ({ path }: { path: string }) => payloadForm.fields.get(path) ?? { value: undefined, setValue: vi.fn() },
  useForm: () => ({ disabled: false, submit: payloadForm.submit }),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => children,
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  pointerWithin: vi.fn(),
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn() }),
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}))

vi.mock('@dnd-kit/sortable', () => ({ sortableKeyboardCoordinates: vi.fn() }))

const layout: TemplateNode[] = [
  {
    id: 'columns',
    type: 'layout',
    layout: 'columns',
    columns: [
      {
        id: 'left',
        width: 60,
        children: [{
          id: 'headline',
          type: 'field',
          fieldType: 'shortText',
          label: 'Story heading',
          content: { source: 'static', value: 'Sample headline' },
          placeholder: 'Sample headline',
        }],
      },
      { id: 'right', width: 40, children: [] },
    ],
  },
  { id: 'closing', type: 'field', fieldType: 'longText', label: 'Closing message', placeholder: 'Goodbye' },
]

function field(value: unknown) {
  return { value, setValue: vi.fn() }
}

beforeEach(() => {
  payloadForm.fields = new Map([
    ['name', field('Newsletter')],
    ['description', field('Newsletter content template')],
    ['slug', field('newsletter')],
    ['allowedCollections', field(['posts'])],
    ['layout', field(layout)],
    ['customFields', field([{ id: 'summary', label: 'Summary', fieldType: 'longText' }])],
    ['sections', field([])],
    ['_status', field('draft')],
  ])
  payloadForm.submit.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ docs: [] }), { status: 200 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TemplateBuilder regression boundary', () => {
  it('preserves the current editor shell, tabs, recursive canvas, and publish controls', async () => {
    render(<TemplateBuilder configuredCollections={['posts']} />)

    expect(screen.getByTestId('template-builder')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Newsletter', level: 1 })).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Canvas' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Template Properties' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Custom Fields/ }).textContent).toContain('1')
    const canvas = screen.getByRole('main', { name: 'Template Canvas' })
    expect(canvas).toBeTruthy()
    expect(within(canvas).getByText(/Columns/).textContent).toContain('60 / 40')
    expect(within(canvas).getByText('Sample headline')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Publish Changes' })).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Responsive preview' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))
    expect(document.querySelector('[data-viewport="mobile"]')).toBeTruthy()

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })

  it('keeps Template Properties and Custom Fields separate from the canvas', () => {
    render(<TemplateBuilder configuredCollections={['posts', 'pages']} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Template Properties' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Newsletter')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Newsletter content template')
    expect((screen.getByLabelText('Posts') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Pages') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole('main', { name: 'Template Canvas' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Custom Fields/ }))
    expect(screen.getByRole('heading', { name: 'Custom Fields' })).toBeTruthy()
    expect(screen.getByDisplayValue('Summary')).toBeTruthy()
    expect((screen.getByLabelText('Field Type 1') as unknown as HTMLSelectElement).value).toBe('longText')
  })

  it('keeps the inserter categories and Post Featured Image binding available', () => {
    render(<TemplateBuilder configuredCollections={['posts']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add element to Template Canvas drop area' }))
    const dialog = screen.getByRole('dialog', { name: 'Add an element' })
    expect(within(dialog).getByRole('tab', { name: 'All' })).toBeTruthy()
    expect(within(dialog).getByRole('tab', { name: 'Text' })).toBeTruthy()
    expect(within(dialog).getByRole('tab', { name: 'Media' })).toBeTruthy()
    expect(within(dialog).getByRole('tab', { name: 'Layout' })).toBeTruthy()
    expect(within(dialog).getByRole('tab', { name: 'Data' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /Image/ }))
    expect(screen.getByRole('heading', { name: 'Configure Image' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Content Source'), { target: { value: 'document' } })
    expect((screen.getByLabelText('Document Field') as unknown as HTMLSelectElement).value).toBe('featuredImage')
    expect(screen.getByRole('option', { name: 'Featured Image' })).toBeTruthy()
  })

  it('adds, moves, deletes, and edits nodes through the extracted canvas controls', () => {
    render(<TemplateBuilder configuredCollections={['posts']} />)
    const setLayout = payloadForm.fields.get('layout')!.setValue

    fireEvent.click(screen.getByRole('button', { name: 'Paragraph' }))
    expect(screen.getByRole('heading', { name: 'Configure Paragraph' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(setLayout).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ type: 'field', fieldType: 'longText' })]))

    setLayout.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Move Closing message up' }))
    expect(setLayout).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'closing' })]))

    setLayout.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Closing message' }))
    expect(setLayout).toHaveBeenCalledWith(expect.not.arrayContaining([expect.objectContaining({ id: 'closing' })]))

    setLayout.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Story heading' }))
    fireEvent.change(screen.getByLabelText('Block Label'), { target: { value: 'Updated story heading' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(JSON.stringify(setLayout.mock.calls.at(-1)?.[0])).toContain('Updated story heading')
  })

  it('keeps Custom Field updates and draft/publish submission behavior', async () => {
    render(<TemplateBuilder configuredCollections={['posts']} />)
    fireEvent.click(screen.getByRole('tab', { name: /Custom Fields/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add field' }))
    expect(payloadForm.fields.get('customFields')!.setValue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ label: 'New field', fieldType: 'longText' })]))

    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(payloadForm.submit).toHaveBeenCalledWith({ overrides: { slug: 'newsletter', status: 'draft', _status: 'draft' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish Changes' }))
    await waitFor(() => expect(payloadForm.submit).toHaveBeenCalledWith({ overrides: { slug: 'newsletter', status: 'published', _status: 'published' } }))
  })

  it('keeps registered Designed Blocks available for insertion', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const docs = url.includes('design-block-types')
        ? [{ id: 7, name: 'Hero Board', rendererKey: 'hero-board', fields: [] as never[] }]
        : url.includes('design-block-designs') ? [{ id: 9, name: 'Feature Hero', blockType: 7 }] : []
      return new Response(JSON.stringify({ docs }), { status: 200 })
    }))
    render(<TemplateBuilder configuredCollections={['posts']} registeredRendererKeys={['hero-board']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hero Board' }))
    expect(screen.getByRole('heading', { name: 'Configure Hero Board' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Design'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(payloadForm.fields.get('layout')!.setValue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ type: 'block', blockType: 7, blockDesign: 9 })]))
  })
})
