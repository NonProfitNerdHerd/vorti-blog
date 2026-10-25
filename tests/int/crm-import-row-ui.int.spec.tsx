// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportRowReview } from '../../src/crm/ImportRowReview'
import type { ImportRuns } from '../../src/crm/import-runs'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('loads a background-saved proposal from current row metadata when the list was stale', async () => {
  vi.stubGlobal('fetch', async (url: string) =>
    new URL(url, 'https://crm.test').searchParams.get('view') === 'review'
      ? Response.json({
          doc: {
            selection: { decision: 'create', target: null },
            values: {},
            issues: [],
            before: null,
            after: { firstName: 'Background-reviewed donor' },
          },
        })
      : Response.json({
          doc: {
            number: 2,
            values: ['Background-reviewed donor'],
            issues: [],
            revision: 2,
            reviewSaved: true,
          },
        }),
  )
  const run = {
    doc: { id: 'run', revision: 3, config_revision: 1, domain: 'contacts', status: 'draft' },
    headers: ['Name'],
    mapping: {
      version: 1,
      domain: 'contacts',
      headers: ['Name'],
      columns: [{ field: 'firstName', column: 0 }],
    },
    canEdit: true,
  } as unknown as Awaited<ReturnType<ImportRuns['get']>>
  render(
    <ImportRowReview
      api="/api"
      site="default"
      run={run}
      number={2}
      reviewSaved={false}
      onSaved={vi.fn()}
      onDirty={vi.fn()}
      onSaving={vi.fn()}
      onDenied={vi.fn()}
    />,
  )
  await screen.findByRole('region', { name: 'Saved proposed changes' })
  expect(
    screen.getByLabelText('Decision').querySelector('option:checked')?.getAttribute('value'),
  ).toBe('create')
})

it('uses an explicitly selected constituent for a gift donor reference without importing automatically', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const writes: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.includes('/crm/contacts?'))
      return Response.json({
        docs: [{ id: 'donor-id', label: 'Chosen donor' }],
        total: 1,
        next: null,
      })
    if (init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)))
      return Response.json({ doc: { revision: 2 } })
    }
    if (new URL(url, 'https://crm.test').searchParams.get('view') === 'review')
      return Response.json({
        doc: {
          selection: { decision: 'create' },
          issues: [],
          before: null,
          after: { contact: 'donor-id' },
        },
      })
    return Response.json({ doc: { number: 2, values: ['legacy-donor'], issues: [], revision: 1 } })
  })
  const run = {
    doc: { id: 'gift-run', revision: 1, config_revision: 1, domain: 'gifts', status: 'draft' },
    headers: ['Donor'],
    mapping: {
      version: 1,
      domain: 'gifts',
      headers: ['Donor'],
      columns: [{ field: 'contact', column: 0 }],
    },
    canEdit: true,
  } as unknown as Awaited<ReturnType<ImportRuns['get']>>
  render(
    <ImportRowReview
      api="/api"
      site="chapter-a"
      run={run}
      number={2}
      onSaved={vi.fn()}
      onDirty={vi.fn()}
      onSaving={vi.fn()}
      onDenied={vi.fn()}
    />,
  )
  await screen.findByText('legacy-donor')
  fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'create' } })
  fireEvent.click(screen.getByText('Correct mapped fields for this row'))
  fireEvent.click(screen.getByRole('button', { name: 'Find constituent for Contact' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Use Chosen donor' }))
  expect(writes).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Save decision and preview changes' }))
  await screen.findByRole('region', { name: 'Saved proposed changes' })
  expect(writes[0]).toMatchObject({
    action: 'review',
    overrides: { contact: { value: 'donor-id', clear: false, referenceMode: 'record' } },
  })
})

it('keeps source data intact, saves a separate explicit review, and displays the authorized proposal', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const writes: Record<string, unknown>[] = [],
    saved = vi.fn(),
    dirty = vi.fn()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)))
      return Response.json({ doc: { revision: 2 } })
    }
    if (new URL(url, 'https://crm.test').searchParams.get('view') === 'review')
      return Response.json({
        doc: {
          selection: { decision: 'create' },
          issues: [],
          before: null,
          after: { firstName: 'Ada' },
        },
      })
    return Response.json({
      doc: { number: 2, values: ['legacy-1', 'Ada'], issues: [], revision: 1 },
    })
  })
  const run = {
    doc: { id: 'run', revision: 4, config_revision: 1, domain: 'contacts', status: 'draft' },
    headers: ['ID', 'First name'],
    mapping: {
      version: 1,
      domain: 'contacts',
      headers: ['ID', 'First name'],
      columns: [
        { field: 'sourceID', column: 0 },
        { field: 'firstName', column: 1 },
      ],
    },
    canEdit: true,
  } as unknown as Awaited<ReturnType<ImportRuns['get']>>
  render(
    <ImportRowReview
      api="/api"
      site="chapter-a"
      run={run}
      number={2}
      onSaved={saved}
      onDirty={dirty}
      onSaving={vi.fn()}
      onDenied={vi.fn()}
    />,
  )
  await screen.findByText('legacy-1')
  expect(writes).toHaveLength(0)
  fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'create' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save decision and preview changes' }))
  await screen.findByRole('region', { name: 'Saved proposed changes' })
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    action: 'review',
    site: 'chapter-a',
    expectedRevision: 4,
    number: 2,
    rowRevision: 1,
    decision: 'create',
    target: null,
    overrides: {},
  })
  expect(screen.getByText('legacy-1')).toBeTruthy()
  expect(dirty).toHaveBeenLastCalledWith(false)
})
