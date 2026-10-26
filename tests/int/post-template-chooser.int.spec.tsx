// DOM environment is selected by the dom Vitest project.
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const drawer = vi.hoisted(() => ({
  saved: undefined as undefined | ((args: { doc: object }) => void),
  open: vi.fn(),
}))
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ permissions: { collections: { 'design-templates': { create: true } } } }),
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
  useDocumentDrawer: () => [
    ({ onSave }: { onSave: typeof drawer.saved }): React.ReactNode => {
      drawer.saved = onSave
      return null
    },
    (): React.ReactNode => null,
    { openDrawer: drawer.open, closeDrawer: vi.fn(), isDrawerOpen: false },
  ],
}))
import { PostTemplateChooser } from '../../packages/payload-design-core/src/admin/PostTemplateChooser'
import type { Template } from '@design-system/payload-design-core'
const props = () => ({
  templates: [] as Template[],
  onChoose: vi.fn(),
  onCancel: vi.fn(),
  onCreated: vi.fn(),
  onRetry: vi.fn(),
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('Post creation tiles', () => {
  it('retires the legacy seed by slug while keeping Blank, Events and custom templates selectable', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ totalDocs: 0 }) })))
    render(<PostTemplateChooser {...props()} templates={[
      { id: 1, slug: 'standard-article', name: 'Legacy seed' },
      { id: 2, slug: 'events', name: 'Events' },
      { id: 3, slug: 'custom-article', name: 'Standard Article' },
    ] as Template[]} />)
    expect(screen.queryByRole('button', { name: /Legacy seed/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Blank/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Events/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Standard Article/ })).toBeTruthy()
  })
  it('requires an explicit selection and never writes a Post on cancellation', () => {
    const options = props()
    render(<PostTemplateChooser {...options} />)
    const create = screen.getByRole('button', { name: 'Create Post' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Blank/ }))
    expect(create.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(options.onCancel).toHaveBeenCalledOnce()
    expect(options.onChoose).not.toHaveBeenCalled()
  })
  it('keeps chooser controls outside the native Post form', () => {
    render(
      <form data-testid="native-post-form">
        <PostTemplateChooser {...props()} />
      </form>,
    )
    expect(screen.getByTestId('native-post-form').contains(screen.getByRole('dialog'))).toBe(false)
  })
  it('ranks tiles by authorized usage and retains names, descriptions and preview images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({ totalDocs: url.endsWith('2') ? 7 : 1 }),
      })),
    )
    const options = {
      ...props(),
      templates: [
        { id: 1, name: 'Alpha', description: 'A story' },
        { id: 2, name: 'Beta', description: 'A newsletter' },
      ] as Template[],
    }
    render(<PostTemplateChooser {...options} />)
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /posts$/ })[0].textContent).toContain('Beta'),
    )
    expect(screen.getByRole('img', { name: 'Beta layout preview' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Post' }))
    expect(options.onChoose).toHaveBeenCalledWith('2')
  })
  it('requires a name, rejects duplicates, preserves input, then opens the existing builder', async () => {
    let duplicate = true
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === 'POST'
          ? { doc: { id: 9 } }
          : { docs: duplicate ? [{ name: 'Article' }] : [] },
    }))
    vi.stubGlobal('fetch', fetch)
    render(<PostTemplateChooser {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }))
    const save = screen.getByRole('button', {
      name: 'Save name and build template',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Article' } })
    fireEvent.click(save)
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Template name')).toHaveProperty('value', 'Article')
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0)
    duplicate = false
    fireEvent.click(save)
    await waitFor(() => expect(drawer.open).toHaveBeenCalledOnce())
    const request = fetch.mock.calls.find((call) => call[1]?.method === 'POST')!
    expect(JSON.parse(request[1]!.body as string)).toMatchObject({
      name: 'Article',
      allowedCollections: ['posts'],
      _status: 'draft',
    })
  })
  it('returns a published template to the chooser without creating a Post', () => {
    const options = props()
    render(<PostTemplateChooser {...options} />)
    act(() =>
      drawer.saved?.({ doc: { id: 8, name: 'Saved', status: 'published', _status: 'published' } }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create Post' }))
    expect(options.onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }))
    expect(options.onChoose).toHaveBeenCalledWith('8')
  })
})
