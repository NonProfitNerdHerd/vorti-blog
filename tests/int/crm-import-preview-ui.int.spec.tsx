// DOM environment is selected by the dom Vitest project.
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportSourcePreview } from '../../src/crm/ImportSourcePreview'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('requires a fresh signed preview after worksheet changes and reuses configuration keys on retry', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const configured = vi.fn(),
    writes: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push(String(init.body))
      if (writes.length === 1) throw Error('Lost response')
      return Response.json({ doc: { id: 'run', revision: 3 } })
    }
    const sheet = new URL(url, 'https://crm.test').searchParams.get('sheet') || 'Donors'
    return Response.json({
      sheets: [
        { name: 'Donors', hidden: false },
        { name: 'Archive', hidden: true },
      ],
      options: { headerRow: 1, sheet, delimiter: ',' },
      headers: ['ID', 'Name'],
      rows: [{ number: 2, values: ['1', sheet === 'Donors' ? 'Ada' : 'Grace'], issues: [] }],
      cursor: { kind: 'xlsx', after: 1 },
      signature: `signed-${sheet}`,
    })
  })
  render(
    <ImportSourcePreview
      api="/api"
      site="chapter-a"
      id="run"
      revision={2}
      kind="xlsx"
      canEdit
      onConfigured={configured}
      onDirty={vi.fn()}
      onSaving={vi.fn()}
      onDenied={vi.fn()}
    />,
  )
  const apply = screen.getByRole('button', { name: 'Use these columns' }) as HTMLButtonElement
  expect(apply.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Preview source' }))
  await screen.findByText('Ada')
  expect(apply.disabled).toBe(false)
  fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: 'Archive' } })
  expect(screen.queryByText('Ada')).toBeNull()
  expect(apply.disabled).toBe(true)
  expect(screen.getByRole('option', { name: 'Donors' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Preview source' }))
  await screen.findByText('Grace')
  fireEvent.click(apply)
  await screen.findByRole('alert')
  fireEvent.click(apply)
  await waitFor(() => expect(configured).toHaveBeenCalledOnce())
  expect(writes).toHaveLength(2)
  expect(writes[0]).toBe(writes[1])
  expect(JSON.parse(writes[0])).toMatchObject({
    action: 'configure',
    site: 'chapter-a',
    expectedRevision: 2,
    signature: 'signed-Archive',
    options: { sheet: 'Archive' },
  })
})
