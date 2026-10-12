// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateNode } from '../types'
import { TemplateBuilder } from './TemplateBuilder'

const payloadForm = vi.hoisted(() => ({
  fields: new Map<string, { setValue: ReturnType<typeof vi.fn>; value: unknown }>(),
  submit: vi.fn(),
  id: undefined as number | undefined,
}))

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({config:{routes:{api:'/api'},serverURL:''}}),
  UploadInput: (): null => null,
  useNav: () => ({navOpen:false,hydrated:true,setNavOpen:vi.fn()}),
  useDocumentInfo: () => ({ hasPublishedDoc: true, id: payloadForm.id }),
  useField: ({ path }: { path: string }) => payloadForm.fields.get(path) ?? { value: undefined, setValue: vi.fn() },
  useForm: () => ({ disabled: false, submit: payloadForm.submit }),
}))

vi.mock('@payloadcms/richtext-lexical/client', () => ({ RenderLexical: () => <div data-testid="lexical-editor" /> }))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => children,
  KeyboardSensor: function KeyboardSensor() {},
  MouseSensor: function MouseSensor() {}, TouchSensor: function TouchSensor() {},
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
  payloadForm.id = undefined
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
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Newsletter')
    expect(screen.getByRole('tab', { name: /^Block$/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Document settings' })).toBeTruthy()
    const canvas = screen.getByRole('main', { name: 'Template Canvas' })
    expect(canvas).toBeTruthy()
    expect(within(canvas).getByText(/Columns/).textContent).toContain('60 / 40')
    expect(within(canvas).getByText('Sample headline')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save Draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Publish/ })).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Responsive preview' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Phone' }))
    expect(document.querySelector('[data-viewport="mobile"]')).toBeTruthy()

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })

  it('keeps Template Properties and Custom Fields separate from the canvas', () => {
    render(<TemplateBuilder configuredCollections={['posts', 'pages']} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Document settings' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Newsletter')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Newsletter content template')
    expect((screen.getByLabelText('Posts') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Pages') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('main', { name: 'Template Canvas' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Document settings' }))
    expect(screen.getByRole('heading', { name: 'Custom Fields', level: 2 })).toBeTruthy()
    expect(screen.getByDisplayValue('Summary')).toBeTruthy()
    expect((screen.getByLabelText('Field Type 1') as unknown as HTMLSelectElement).value).toBe('longText')
  })

  it('keeps the inserter categories and Post Featured Image binding available', () => {
    render(<TemplateBuilder configuredCollections={['posts']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add element to Template Canvas drop area' }))
    const dialog = document.querySelector('.builder-sidebar') as HTMLElement
    expect(within(dialog).getByRole('heading', { name: 'Text' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Media' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Layout' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: 'Template fields' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Template field' }))
    fireEvent.change(screen.getByLabelText('Template field type'), {target:{value:'image'}})
    expect(screen.getByRole('heading', { name: 'Image' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Content Source'), { target: { value: 'document' } })
    expect((screen.getByLabelText('Document Field') as unknown as HTMLSelectElement).value).toBe('featuredImage')
  })

  it('adds, moves, deletes, and edits nodes through the extracted canvas controls', () => {
    render(<TemplateBuilder configuredCollections={['posts']} />)
    const setLayout = payloadForm.fields.get('layout')!.setValue

    fireEvent.click(screen.getByRole('button', {name:'Add block'}))
    fireEvent.click(screen.getByRole('button', { name: 'Paragraph' }))
    expect(screen.getByRole('heading', { name: 'Paragraph' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save Element' })).toBeNull()
    expect(setLayout).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ block: expect.objectContaining({kind:'paragraph'}) })]))

    setLayout.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Closing message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    expect(setLayout).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'closing' })]))

    setLayout.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Closing message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(setLayout).toHaveBeenCalledWith(expect.not.arrayContaining([expect.objectContaining({ id: 'closing' })]))

    setLayout.mockClear()
    fireEvent.click(within(document.querySelector('.builder-sidebar') as HTMLElement).getByRole('button', { name: 'Story heading' }))
    fireEvent.change(screen.getByLabelText('Block Label'), { target: { value: 'Updated story heading' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Element' }))
    expect(JSON.stringify(setLayout.mock.calls.at(-1)?.[0])).toContain('Updated story heading')
  })

  it('keeps Custom Field updates while leaving submission to Payload', async () => {
    render(<TemplateBuilder configuredCollections={['posts']} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Document settings' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add field' }))
    expect(payloadForm.fields.get('customFields')!.setValue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ label: 'New field', fieldType: 'longText' })]))

    expect(payloadForm.submit).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', {name:'Add block'}))
    fireEvent.click(await screen.findByRole('button', { name: 'Hero Board' }))
    expect(screen.getByRole('heading', { name: 'Hero Board' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Layout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Feature Hero' }))
    expect(payloadForm.fields.get('layout')!.setValue).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ type: 'block', blockType: 7, blockDesign: 9 })]))
  })
})

it('hydrates once without marking the native form dirty on ordinary field updates', async () => {
  payloadForm.id = 42
  const fetcher = vi.fn(async (input: string) => new Response(JSON.stringify(input.includes('/42?') ? { layout: [], customFields: [], sections: [] } : input.endsWith('/dependencies') ? [] : { docs: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const view = render(<TemplateBuilder configuredCollections={['posts']} />)
  await waitFor(() => expect(payloadForm.fields.get('layout')!.setValue).toHaveBeenCalledWith([], true))
  payloadForm.fields.set('layout', { ...payloadForm.fields.get('layout')!, value: [] })
  view.rerender(<TemplateBuilder configuredCollections={['posts']} />)
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.includes('/42?'))).toHaveLength(1))
})
