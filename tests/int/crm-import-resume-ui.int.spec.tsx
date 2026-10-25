// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportUploadResume } from '../../src/crm/ImportUploadResume'
import type { ImportRuns } from '../../src/crm/import-runs'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('rejects different contents and resumes the retained import with verified original bytes', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const bytes = new TextEncoder().encode('ID\n1'),
    digest = await crypto.subtle.digest('SHA-256', bytes),
    sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    ),
    fetcher = vi.fn(async () => Response.json({ doc: { id: 'existing-run', revision: 2 } })),
    uploaded = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const run = {
    doc: {
      id: 'existing-run',
      file_name: 'original.csv',
      file_size: bytes.length,
      file_sha256: sha256,
      revision: 1,
    },
    canEdit: true,
  } as unknown as Awaited<ReturnType<ImportRuns['get']>>
  render(
    <ImportUploadResume
      api="/api"
      site="chapter-a"
      run={run}
      onUploaded={uploaded}
      onDirty={vi.fn()}
      onSaving={vi.fn()}
      onDenied={vi.fn()}
    />,
  )
  const choose = (value: string) => {
    const file = new File([value], 'original.csv')
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(value).buffer,
    })
    fireEvent.change(screen.getByLabelText('Original source file'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Resume source upload' }))
  }
  choose('ID\n2')
  await screen.findByRole('alert')
  expect(fetcher).not.toHaveBeenCalled()
  choose('ID\n1')
  await waitFor(() => expect(uploaded).toHaveBeenCalledOnce())
  expect(fetcher).toHaveBeenCalledOnce()
  const [url, init] = (fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]
  expect(url).toContain('id=existing-run')
  expect(url).toContain('site=chapter-a')
  expect(init.method).toBe('PUT')
  expect(init.body).toEqual(bytes.buffer)
})
