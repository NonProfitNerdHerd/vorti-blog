// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportSourceUpload } from '../../src/crm/ImportSourceUpload'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('retries an uncertain upload with the original run, revision, bytes and operation key', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const calls: Array<{ url: string; init?: RequestInit }> = [],
    uploaded = vi.fn(),
    dirty = vi.fn(),
    denied = vi.fn()
  let uploads = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (init?.method === 'POST') return Response.json({ doc: { id: 'retained-run', revision: 1 } })
    if (++uploads === 1) throw Error('Connection interrupted')
    return Response.json({ doc: { id: 'retained-run', revision: 2 } })
  })
  render(
    <ImportSourceUpload
      api="/api"
      site="chapter-a"
      domain="contacts"
      onUploaded={uploaded}
      onDirty={dirty}
      onSaving={vi.fn()}
      onDenied={denied}
    />,
  )
  fireEvent.change(screen.getByLabelText('Import name'), { target: { value: 'Donor migration' } })
  fireEvent.change(screen.getByLabelText('Source platform or dataset'), {
    target: { value: 'Legacy donors' },
  })
  const bytes = new TextEncoder().encode('ID,Name\n1,Ada'),
    file = new File(['ID,Name\n1,Ada'], 'donors.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  fireEvent.change(screen.getByLabelText('CSV or XLSX file'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }))
  await screen.findByRole('alert')
  expect(uploaded).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Upload and preview' }))
  await waitFor(() => expect(uploaded).toHaveBeenCalledWith('retained-run'))
  expect(calls).toHaveLength(3)
  expect(calls[1].url).toBe(calls[2].url)
  expect(calls[1].url).toContain('site=chapter-a')
  expect(calls[1].init?.body).toEqual(bytes.buffer)
  expect(calls[2].init?.body).toEqual(bytes.buffer)
  const creation = JSON.parse(String(calls[0].init?.body))
  expect(creation.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(creation.domain).toBe('contacts')
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(denied).not.toHaveBeenCalled()
})
