// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportWorkspace } from '../../src/crm/ImportWorkspace'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
vi.mock('../../src/crm/ImportRunWorkspace', () => ({
  ImportRunWorkspace: ({ id }: { id: string }) => <p>Selected run {id}</p>,
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('opens and reloads a chapter-pinned import URL and removes private runs when chapter access is revoked', async () => {
  window.history.replaceState(null, '', '/admin/crm?site=default&view=imports')
  let revoked = false
  const requests: URL[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, window.location.origin)
    requests.push(url)
    if (revoked) return Response.json({ message: 'No access' }, { status: 403 })
    if (url.searchParams.get('view') === 'context')
      return Response.json({
        site: { id: 'default', name: 'Chapter' },
        domains: [{ id: 'contacts', label: 'Contacts', canCreate: true }],
      })
    return Response.json({
      docs: [
        {
          id: 'saved-run',
          name: 'Previous donors',
          source_system: 'Legacy',
          file_name: 'donors.csv',
          stage_state: 'review',
          status: 'draft',
        },
      ],
      total: 1,
      next: null,
      canCreate: true,
    })
  })
  const first = render(<ImportWorkspace api="/api" site="default" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Open Previous donors' }))
  await screen.findByText('Selected run saved-run')
  expect(new URLSearchParams(window.location.search).get('importID')).toBe('saved-run')
  expect(new URLSearchParams(window.location.search).get('importDomain')).toBe('contacts')
  first.unmount()
  render(<ImportWorkspace api="/api" site="default" />)
  await screen.findByText('Selected run saved-run')
  expect(requests.every((url) => url.searchParams.get('site') === 'default')).toBe(true)
  revoked = true
  fireEvent.focus(window)
  await waitFor(() => expect(screen.queryByText('Selected run saved-run')).toBeNull())
  expect(screen.getByRole('alert').textContent).toContain('Import access is unavailable')
})
