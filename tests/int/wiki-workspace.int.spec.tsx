// DOM environment is selected by the dom Vitest project.
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KnowledgeWorkspace } from '../../src/knowledge/KnowledgeWorkspace'
vi.mock('../../src/knowledge/RichTextEditor', () => ({
  KnowledgeRichTextEditor: () => <div>Article editor</div>,
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const doc = {
  id: 'article',
  title: 'Initial article',
  slug: 'initial',
  parent: null as string | null,
  body: {
    root: {
      type: 'root',
      children: [{ type: 'heading', tag: 'h4', children: [{ type: 'text', text: 'Section' }] }],
    },
  },
  visibility: 'private' as const,
  revision: 2,
  published: true,
  attachments: [{ id: 'file', filename: 'manual.pdf', size: 10 }],
}
const props = {
  site: 'default',
  kind: 'wiki' as const,
  prefix: '',
  id: doc.id,
  initial: { docs: [{ ...doc, published: 1 }], next: null as string | null },
  manage: false,
  initialDoc: doc,
  permissions: [] as string[],
}
it('renders the server article, contents, files and shared login without fetching it again', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  render(<KnowledgeWorkspace {...props} loginHref="/admin/login?redirect=%2Fwiki" />)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Initial article')
  expect(screen.getByRole('link', { name: 'Section' }).getAttribute('href')).toBe('#wiki-section')
  expect(screen.getByRole('heading', { level: 4 }).id).toBe('wiki-section')
  expect(screen.getByRole('link', { name: 'manual.pdf' }).getAttribute('href')).not.toContain(
    'draft=1',
  )
  expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe(
    '/admin/login?redirect=%2Fwiki',
  )
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
it('allows history without exposing editing controls', () => {
  render(
    <KnowledgeWorkspace
      {...props}
      view="history"
      manage
      permissions={['wiki:read-history']}
      initialVersions={[{ revision: 1, title: 'Earlier', body: doc.body, createdAt: '2026-10-28' }]}
    />,
  )
  expect(screen.getByRole('heading', { name: 'Revision history' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
})
it('retains a conflicting draft and blocks navigation when changes are unsaved', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) }),
  )
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(
    <KnowledgeWorkspace
      {...props}
      view="edit"
      manage
      permissions={['wiki:read-history', 'wiki:edit']}
    />,
  )
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Retained draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Your draft is retained'),
  )
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Retained draft')
  fireEvent.click(screen.getByRole('link', { name: 'Read' }))
  expect(confirm).toHaveBeenCalledWith('Discard unsaved page changes?')
})
it('searches the authorized list and keeps history flags out of reading requests', async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ docs: [] as typeof props.initial.docs, next: null as string | null }),
  })
  vi.stubGlobal('fetch', fetch)
  render(<KnowledgeWorkspace {...props} initialDoc={null} />)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Needle' } })
  fireEvent.submit(screen.getByRole('search'))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(fetch.mock.calls[0][0]).toContain('search=Needle')
  expect(fetch.mock.calls[0][0]).not.toContain('draft=1')
  await waitFor(() => expect(screen.getByText('No pages available.')).toBeTruthy())
})
it('keeps save feedback visible after refreshing the page hierarchy', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 3 }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ docs: [] as typeof props.initial.docs, next: null as string | null }),
    })
  vi.stubGlobal('fetch', fetch)
  render(
    <KnowledgeWorkspace
      {...props}
      view="edit"
      manage
      permissions={['wiki:read-history', 'wiki:edit']}
    />,
  )
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Saved title' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByText('No pages available.')).toBeTruthy())
  expect(screen.getByRole('status').textContent).toBe('Page saved.')
})
