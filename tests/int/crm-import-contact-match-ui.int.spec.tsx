// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportContactMatch } from '../../src/crm/ImportContactMatch'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('pages candidates, makes no automatic choice, and clears matches after permission denial', async () => {
  const change = vi.fn(),
    denied = vi.fn(),
    requests: URL[] = []
  let revoked = false
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'https://crm.test')
    requests.push(url)
    if (revoked) return Response.json({ message: 'No access' }, { status: 403 })
    return Response.json(
      url.searchParams.get('afterID')
        ? { total: 26, docs: [{ id: 'last', label: 'Final candidate' }], next: null }
        : {
            total: 26,
            docs: [{ id: 'first', label: 'First candidate' }],
            next: { id: 'first', label: 'First candidate' },
          },
    )
  })
  render(
    <ImportContactMatch
      api="/api"
      site="chapter-a"
      value=""
      disabled={false}
      onChange={change}
      onDenied={denied}
    />,
  )
  await screen.findByRole('button', { name: 'Use First candidate' })
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'More matches' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Use Final candidate' }))
  expect(change).toHaveBeenCalledWith('last')
  expect(requests[1].searchParams.get('afterLabel')).toBe('First candidate')
  expect(requests[1].searchParams.get('site')).toBe('chapter-a')
  revoked = true
  fireEvent.change(screen.getByLabelText('Search constituent name or email'), {
    target: { value: 'shared@example.invalid' },
  })
  await waitFor(() => expect(denied).toHaveBeenCalledOnce())
  expect(screen.queryByRole('button', { name: 'Use Final candidate' })).toBeNull()
})
