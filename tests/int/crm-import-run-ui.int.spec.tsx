// DOM environment is selected by the dom Vitest project.
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImportRunWorkspace } from '../../src/crm/ImportRunWorkspace'
vi.mock('@payloadcms/ui', () => ({ Gutter: (): null => null }))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({ useAdminSite: () => ({}) }))
type EditorCallbacks = { onDirty: (value: boolean) => void; onSaving: (value: boolean) => void }
const editors = vi.hoisted(() => ({
  mapping: undefined as EditorCallbacks | undefined,
  rows: undefined as EditorCallbacks | undefined,
}))
vi.mock('../../src/crm/ImportMappingEditor', () => ({
  ImportMappingEditor: (props: EditorCallbacks) => {
    editors.mapping = props
    return <input aria-label="Mapping draft" defaultValue="" onChange={() => props.onDirty(true)} />
  },
}))
vi.mock('../../src/crm/ImportRowsWorkspace', () => ({
  ImportRowsWorkspace: (props: EditorCallbacks): null => {
    editors.rows = props
    return null
  },
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('retains a draft across external revision refresh, confirms discard, and still clears revoked access', async () => {
  let revision = 1,
    revoked = false
  const denied = vi.fn(),
    dirty = vi.fn()
  vi.stubGlobal('fetch', async () =>
    revoked
      ? Response.json({ message: 'Access denied' }, { status: 403 })
      : Response.json({
          doc: {
            id: 'run',
            name: `Saved version ${revision}`,
            file_name: 'donors.csv',
            source_system: 'Legacy',
            stage_state: 'review',
            status: 'draft',
            revision,
            config_revision: revision,
            domain: 'contacts',
          },
          headers: ['ID'],
          mapping: { version: 1, domain: 'contacts', headers: ['ID'], columns: [] },
          canEdit: true,
          totals: {
            rows: 1,
            applied: 0,
            reviewed: 1,
            pending: 1,
            pendingReviewed: 1,
            created: 0,
            updated: 0,
            kept: 0,
            skipped: 0,
          },
          job: null,
        }),
  )
  render(
    <ImportRunWorkspace
      api="/api"
      site="default"
      id="run"
      onDirty={dirty}
      onSaving={vi.fn()}
      onDenied={denied}
    />,
  )
  fireEvent.change(await screen.findByLabelText('Mapping draft'), {
    target: { value: 'Unsaved local mapping' },
  })
  revision = 2
  fireEvent.focus(window)
  await screen.findByText(/This import changed while you were editing/)
  expect((screen.getByLabelText('Mapping draft') as unknown as { value: string }).value).toBe(
    'Unsaved local mapping',
  )
  expect(screen.getByRole('heading', { name: 'Saved version 1' })).toBeTruthy()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and reload saved import' }))
  expect((screen.getByLabelText('Mapping draft') as unknown as { value: string }).value).toBe(
    'Unsaved local mapping',
  )
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and reload saved import' }))
  await screen.findByRole('heading', { name: 'Saved version 2' })
  expect((screen.getByLabelText('Mapping draft') as unknown as { value: string }).value).toBe('')
  expect(dirty).toHaveBeenLastCalledWith(false)
  fireEvent.change(screen.getByLabelText('Mapping draft'), { target: { value: 'Private draft' } })
  revoked = true
  fireEvent.focus(window)
  await waitFor(() => expect(denied).toHaveBeenCalled())
  expect(screen.queryByLabelText('Mapping draft')).toBeNull()
  expect(dirty).toHaveBeenLastCalledWith(false)
})

it('retains another editor’s unsaved and saving guards when a sibling reports completion', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      doc: {
        id: 'run',
        name: 'Independent editor activity',
        file_name: 'donors.csv',
        source_system: 'Legacy',
        stage_state: 'review',
        status: 'draft',
        revision: 1,
        config_revision: 1,
        domain: 'contacts',
      },
      headers: ['ID'],
      mapping: { version: 1, domain: 'contacts', headers: ['ID'], columns: [] },
      canEdit: true,
      totals: {
        rows: 1,
        applied: 0,
        reviewed: 1,
        pending: 1,
        pendingReviewed: 1,
        created: 0,
        updated: 0,
        kept: 0,
        skipped: 0,
      },
      job: null,
    }),
  )
  const onDirty = vi.fn(),
    onSaving = vi.fn()
  const mounted = render(
    <ImportRunWorkspace
      api="/api"
      site="default"
      id="run"
      onDirty={onDirty}
      onSaving={onSaving}
      onDenied={vi.fn()}
    />,
  )
  const approve = await screen.findByRole('button', { name: 'Approve and apply reviewed records' })
  const blocked = () => (approve.closest('fieldset') as unknown as { disabled: boolean }).disabled
  act(() => {
    editors.mapping!.onDirty(true)
    editors.rows!.onDirty(false)
  })
  expect(onDirty).toHaveBeenLastCalledWith(true)
  expect(blocked()).toBe(true)
  expect(
    (
      screen.getByRole('group', { name: 'Source rows and decisions' }) as unknown as {
        disabled: boolean
      }
    ).disabled,
  ).toBe(true)
  act(() => {
    editors.mapping!.onSaving(true)
    editors.rows!.onSaving(false)
  })
  expect(onSaving).toHaveBeenLastCalledWith(true)
  act(() => {
    editors.mapping!.onDirty(false)
    editors.rows!.onDirty(true)
    editors.mapping!.onSaving(false)
  })
  expect(onDirty).toHaveBeenLastCalledWith(true)
  expect(blocked()).toBe(true)
  expect(
    (screen.getByRole('group', { name: 'Field mapping' }) as unknown as { disabled: boolean })
      .disabled,
  ).toBe(true)
  act(() => editors.rows!.onDirty(false))
  expect(onDirty).toHaveBeenLastCalledWith(false)
  expect(blocked()).toBe(false)
  const callback = editors.rows!.onSaving
  mounted.unmount()
  const calls = onSaving.mock.calls.length
  act(() => callback(false))
  expect(onSaving).toHaveBeenCalledTimes(calls)
})

it('approves only explicitly, counts remaining reviews after partial application, and clears a revoked run', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const writes: Record<string, unknown>[] = [],
    denied = vi.fn()
  let revoked = false,
    approved = false
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (revoked) return Response.json({ message: 'Access denied' }, { status: 403 })
    if (init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)))
      approved = true
      return Response.json({ doc: { id: 'run' }, backgroundWakePending: true })
    }
    return Response.json({
      doc: {
        id: 'run',
        name: 'Private donors',
        file_name: 'donors.csv',
        source_system: 'Legacy',
        stage_state: 'review',
        status: approved ? 'approved' : 'draft',
        revision: 7,
        config_revision: 3,
        domain: 'contacts',
        file_kind: 'csv',
      },
      headers: ['ID'],
      mapping: { version: 1, domain: 'contacts', headers: ['ID'], columns: [] },
      canEdit: true,
      totals: {
        rows: 3,
        applied: 1,
        reviewed: 2,
        pending: 2,
        pendingReviewed: 2,
        created: 1,
        updated: 0,
        kept: 0,
        skipped: 0,
      },
      job: null,
    })
  })
  render(
    <ImportRunWorkspace
      api="/api"
      site="chapter-a"
      id="run"
      onDirty={vi.fn()}
      onSaving={vi.fn()}
      onDenied={denied}
    />,
  )
  const approve = await screen.findByRole('button', { name: 'Approve and apply reviewed records' })
  expect((approve as HTMLButtonElement).disabled).toBe(false)
  expect(writes).toHaveLength(0)
  fireEvent.click(approve)
  await screen.findByText(/Background dispatch has not acknowledged/)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    action: 'approve',
    site: 'chapter-a',
    id: 'run',
    expectedRevision: 7,
    allowNewUnidentified: false,
  })
  revoked = true
  fireEvent.focus(window)
  await waitFor(() => expect(denied).toHaveBeenCalled())
  expect(screen.queryByText('Private donors')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Download original source' })).toBeNull()
})
