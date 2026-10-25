// DOM environment is selected by the dom Vitest project.
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordTasks } from '../../src/crm/RecordTasks'
import { ContactActivities } from '../../src/crm/ContactActivities'
import { ContactFollowUps } from '../../src/crm/ContactFollowUps'
import type { Task } from '../../src/review/client'
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../../src/organizations/AdminSiteProvider', () => ({
  useAdminSite: () => ({ binding: { site: { id: 'default' } } }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const props = () => ({
  api: '/api',
  admin: '/admin',
  site: 'default',
  link: { type: 'contact' as const, id: 'fictional-donor' },
  onDirty: vi.fn(),
  onSaving: vi.fn(),
})
it('carries a saved phone note into a follow-up assigned to another staff member', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const submissions: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, 'https://crm.test')
    if (parsed.pathname.endsWith('/activities')) {
      if (init?.method === 'POST') return Response.json({ doc: { id: 'fictional-saved-call' } })
      return Response.json({ docs: [], next: null, canEdit: true })
    }
    if (init?.method === 'POST') {
      submissions.push(JSON.parse(String(init.body)))
      return Response.json({ doc: { id: 45 } })
    }
    if (parsed.searchParams.get('view') === 'people')
      return Response.json({ docs: [{ id: 2, label: 'Fictional other staff member' }], next: null })
    return Response.json({
      docs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      canCreate: true,
      record: { id: 'fictional-donor', label: 'Fictional donor', revision: 3 },
      authorityRevision: 4,
    })
  })
  render(
    <ContactFollowUps
      api="/api"
      admin="/admin"
      site="default"
      contact="fictional-donor"
      onDirty={vi.fn()}
      onSaving={vi.fn()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Record communication' }))
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'phone' } })
  fireEvent.change(screen.getByLabelText('Subject'), {
    target: { value: 'Fictional donor renewal' },
  })
  fireEvent.change(screen.getByLabelText('Occurred on'), { target: { value: '2026-10-25' } })
  fireEvent.change(screen.getByLabelText('Text'), {
    target: { value: 'Fictional donor requested a renewal call.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and assign follow-up' }))
  fireEvent.click(await screen.findByRole('button', { name: 'New follow-up' }))
  expect((screen.getByLabelText('Task title') as HTMLInputElement).value).toBe(
    'Fictional donor renewal',
  )
  await screen.findByRole('option', { name: 'Fictional other staff member' })
  fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create follow-up task' }))
  await waitFor(() => expect(submissions).toHaveLength(1))
  expect(submissions[0]).toMatchObject({
    action: 'create',
    site: 'default',
    type: 'contact',
    id: 'fictional-donor',
    activity: 'fictional-saved-call',
    title: 'Fictional donor renewal',
    assignee: 2,
    expectedRevision: 3,
    expectedAuthorityRevision: 4,
  })
})
it.each([false, true])(
  'opens follow-up assignment only after saving the note and an authorized refresh (revoked=%s)',
  async (revoked) => {
    vi.stubGlobal('crypto', webcrypto)
    const onFollowUp = vi.fn(),
      posts: Array<Record<string, unknown>> = []
    let saved = false
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        saved = true
        return Response.json({ doc: { id: 'fictional-call-note' } })
      }
      if (saved && revoked)
        return Response.json({ message: 'Chapter access revoked.' }, { status: 403 })
      return Response.json({ docs: [], next: null, canEdit: true })
    })
    render(
      <ContactActivities
        api="/api"
        site="default"
        contact="fictional-donor"
        onDirty={vi.fn()}
        onSaving={vi.fn()}
        onFollowUp={onFollowUp}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Record communication' }))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'phone' } })
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Fictional renewal call' },
    })
    fireEvent.change(screen.getByLabelText('Occurred on'), { target: { value: '2026-10-25' } })
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'Fictional donor asked for a follow-up.' },
    })
    expect(onFollowUp).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save and assign follow-up' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({
      site: 'default',
      contact: 'fictional-donor',
      values: { kind: 'phone', subject: 'Fictional renewal call' },
    })
    if (revoked) {
      await screen.findByText('Chapter access revoked.')
      expect(onFollowUp).not.toHaveBeenCalled()
    } else
      await waitFor(() =>
        expect(onFollowUp).toHaveBeenCalledExactlyOnceWith({
          id: 'fictional-call-note',
          subject: 'Fictional renewal call',
        }),
      )
  },
)
it('retains the same submitted intent and key after a lost reply and source refresh, then completes the native Task', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const tasks: Task[] = [],
    posts: Array<Record<string, unknown>> = [],
    patches: Array<{ site: string | null; data: Record<string, unknown> }> = []
  let revision = 1,
    epoch = 1,
    lost = true
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, 'https://crm.test')
    if (init?.method === 'POST') {
      const input = JSON.parse(String(init.body))
      posts.push(input)
      if (!tasks.length)
        tasks.push({
          id: 45,
          title: input.title,
          status: 'open',
          priority: 'normal',
          assignee: 2,
          assigneePerson: { id: 2, label: 'Fictional staff member' },
          updatedAt: '2026-10-25T12:00:00.000Z',
          canEdit: true,
        })
      if (lost) {
        lost = false
        throw new Error('Fictional lost response')
      }
      return Response.json({ doc: { id: 45 } })
    }
    if (init?.method === 'PATCH') {
      const data = JSON.parse(String(init.body))
      patches.push({ site: new Headers(init.headers).get('x-vorticause-site'), data })
      tasks[0].status = 'done'
      return Response.json({ ...tasks[0] })
    }
    if (parsed.searchParams.get('view') === 'people')
      return Response.json({ docs: [{ id: 2, label: 'Fictional staff member' }], next: null })
    const state = parsed.searchParams.get('state'),
      docs = tasks.filter(
        (task) =>
          state === 'all' ||
          (state === 'completed' ? task.status === 'done' : task.status !== 'done'),
      )
    return Response.json({
      docs,
      total: docs.length,
      page: 1,
      totalPages: 1,
      canCreate: true,
      record: { id: 'fictional-donor', label: 'Fictional donor', revision },
      authorityRevision: epoch,
    })
  })
  render(<RecordTasks {...props()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'New follow-up' }))
  fireEvent.change(screen.getByLabelText('Task title'), {
    target: { value: 'Call fictional donor' },
  })
  await screen.findByRole('option', { name: 'Fictional staff member' })
  fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create follow-up task' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('lost response'))
  revision = 2
  epoch = 9
  fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }))
  await screen.findByRole('link', { name: 'Call fictional donor' })
  fireEvent.click(screen.getByRole('button', { name: 'Create follow-up task' }))
  await waitFor(() => expect(screen.queryByText('Assign a follow-up')).toBeNull())
  expect(posts).toHaveLength(2)
  expect(posts[1]).toEqual(posts[0])
  expect(posts[1].expectedRevision).toBe(1)
  expect(tasks).toHaveLength(1)
  const link = await screen.findByRole('link', { name: 'Call fictional donor' })
  expect(link.getAttribute('href')).toBe('/admin/collections/review-tasks?site=default&task=45')
  fireEvent.click(screen.getByRole('button', { name: 'Complete Call fictional donor' }))
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Call fictional donor' })).toBeNull(),
  )
  expect(patches).toEqual([
    { site: 'default', data: { status: 'done', expectedUpdatedAt: '2026-10-25T12:00:00.000Z' } },
  ])
  fireEvent.change(screen.getByLabelText('Task status'), { target: { value: 'completed' } })
  await screen.findByRole('link', { name: 'Call fictional donor' })
})
it('clears cached Task titles, assignees and drafts after a denied mutation', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const input = props()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return Response.json({ message: 'CRM permissions changed.' }, { status: 403 })
    if (new URL(url, 'https://crm.test').searchParams.get('view') === 'people')
      return Response.json({ docs: [{ id: 2, label: 'Fictional private assignee' }], next: null })
    return Response.json({
      docs: [
        { id: 45, title: 'Fictional existing private task', status: 'open', priority: 'normal' },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
      canCreate: true,
      record: { id: input.link.id, label: 'Fictional private donor', revision: 1 },
      authorityRevision: 1,
    })
  })
  render(<RecordTasks {...input} />)
  await screen.findByRole('link', { name: 'Fictional existing private task' })
  fireEvent.click(screen.getByRole('button', { name: 'New follow-up' }))
  fireEvent.change(screen.getByLabelText('Task title'), {
    target: { value: 'Fictional private draft' },
  })
  await screen.findByRole('option', { name: 'Fictional private assignee' })
  fireEvent.click(screen.getByRole('button', { name: 'Create follow-up task' }))
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('permissions changed'),
  )
  expect(screen.queryByRole('link', { name: 'Fictional existing private task' })).toBeNull()
  expect(screen.queryByLabelText('Task title')).toBeNull()
  expect(screen.queryByRole('option', { name: 'Fictional private assignee' })).toBeNull()
  expect(input.onDirty).toHaveBeenLastCalledWith(false)
})
