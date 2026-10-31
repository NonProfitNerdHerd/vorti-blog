// DOM environment is selected by the dom Vitest project.
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HouseholdWorkspace } from '../../src/crm/HouseholdWorkspace'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/crm',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'chapter-a' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('opens a chapter-pinned household on reload and clears its address when closed', async () => {
  window.history.replaceState(null, '', '/?view=households&site=chapter-a&household=family-1')
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input, window.location.href)
    expect(url.searchParams.get('site')).toBe('chapter-a')
    if (url.pathname.endsWith('/contacts')) return Response.json({ docs: [], total: 0, next: null })
    if (url.searchParams.get('id'))
      return Response.json({
        doc: {
          id: 'family-1',
          name: 'River household',
          address: '100 River Road',
          primary_contact: null,
          archived: 0,
          revision: 1,
        },
        members: [],
        canEdit: false,
      })
    return Response.json({ docs: [], next: null, canEdit: false })
  })
  vi.stubGlobal('fetch', fetcher)
  const mounted = render(<HouseholdWorkspace />)
  await screen.findByRole('heading', { name: 'River household' })
  expect(screen.getByText(/100 River Road/)).toBeTruthy()
  mounted.unmount()
  render(<HouseholdWorkspace />)
  await screen.findByRole('heading', { name: 'River household' })
  fireEvent.click(screen.getByRole('button', { name: 'Close household' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'River household' })).toBeNull())
  expect(new URLSearchParams(window.location.search).has('household')).toBe(false)
})

it('does not request a household addressed to a different chapter', async () => {
  window.history.replaceState(null, '', '/?view=households&site=chapter-b&household=private-family')
  const fetcher = vi.fn(async (_url: string) =>
    Response.json({ docs: [], next: null, canEdit: false }),
  )
  vi.stubGlobal('fetch', fetcher)
  render(<HouseholdWorkspace />)
  await waitFor(() => expect(fetcher).toHaveBeenCalled())
  expect(
    fetcher.mock.calls.every(
      ([url]) => !new URL(String(url), window.location.href).searchParams.has('id'),
    ),
  ).toBe(true)
})
