// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordTaskPage } from '../../src/crm/RecordTaskPage'
import { RecordActions } from '../../src/crm/RecordActions'
import { crmRecordTypes } from '../../src/crm/record-model'

vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/admin' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('opens every typed record tool with its chapter pinned and preserves the source tab', () => {
  for (const type of crmRecordTypes) {
    const mounted = render(<RecordActions site="chapter/a" link={{ type, id: 'record & one' }} />)
    const link = screen.getByRole('link', { name: 'Record follow-up tasks (opens in another tab)' })
    const url = new URL(link.getAttribute('href')!, window.location.href)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      site: 'chapter/a',
      view: 'record-tasks',
      recordType: type,
      recordID: 'record & one',
    })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(
      screen.getByRole('link', { name: 'Private record attachments (opens in another tab)' }),
    ).toBeTruthy()
    mounted.unmount()
  }
})

it('assigns a typed follow-up through native Tasks, reloads it, and clears private titles after revocation', async () => {
  let created: Record<string, unknown> | null = null
  let denied = false
  const task = {
    id: 42,
    title: 'Discuss annual support',
    status: 'todo',
    updatedAt: '2026-10-25T00:00:00Z',
    canEdit: true,
    assigneeLabel: 'Local staff',
  }
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.href)
    if (init?.method === 'POST') {
      created = JSON.parse(String(init.body)) as Record<string, unknown>
      return Response.json({ doc: task })
    }
    expect(url.searchParams.get('site')).toBe('chapter-a')
    expect(url.searchParams.get('type')).toBe('opportunity')
    expect(url.searchParams.get('id')).toBe('opportunity-1')
    if (denied) return Response.json({ message: 'Record access revoked.' }, { status: 403 })
    if (url.searchParams.get('view') === 'people')
      return Response.json({ docs: [{ id: 7, label: 'Local staff' }], next: null })
    return Response.json({
      docs: created ? [task] : [],
      total: created ? 1 : 0,
      page: 1,
      totalPages: 1,
      canCreate: true,
      record: { id: 'opportunity-1', label: 'Annual support', revision: 3 },
      authorityRevision: 9,
    })
  })
  const props = { site: 'chapter-a', type: 'opportunity', id: 'opportunity-1' }
  let mounted = render(<RecordTaskPage {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'New follow-up' }))
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: task.title } })
  await screen.findByRole('option', { name: 'Local staff' })
  fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: '7' } })
  fireEvent.change(screen.getByLabelText('Follow-up due date'), { target: { value: '2026-11-01' } })
  const guard = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(guard)
  expect(guard.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Create follow-up task' }))
  await screen.findByRole('link', { name: task.title })
  expect(created).toMatchObject({
    action: 'create',
    site: 'chapter-a',
    type: 'opportunity',
    id: 'opportunity-1',
    expectedRevision: 3,
    expectedAuthorityRevision: 9,
    assignee: 7,
    dueOn: '2026-11-01',
  })
  mounted.unmount()
  mounted = render(<RecordTaskPage {...props} />)
  await screen.findByRole('link', { name: task.title })
  denied = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }))
  await screen.findByText('Record access revoked.')
  await waitFor(() => expect(screen.queryByRole('link', { name: task.title })).toBeNull())
  expect(screen.queryByRole('button', { name: 'New follow-up' })).toBeNull()
  mounted.unmount()
})

it('rejects an invalid typed address before requesting private task data', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<RecordTaskPage site="chapter-a" type="unknown" id="record-1" />)
  expect(screen.getByRole('alert').textContent).toContain('Choose a valid CRM record')
  expect(fetcher).not.toHaveBeenCalled()
})
