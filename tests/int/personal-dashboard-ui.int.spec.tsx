// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardClient } from '@/dashboard/DashboardClient'
import { reviewAPI } from '@/review/client'

const { select, auth } = vi.hoisted(() => ({
  select: vi.fn(),
  auth: {
    user: { id: 7, displayName: 'Alex Smith' },
    permissions: {
      collections: { posts: { create: true }, pages: { create: false } } as Record<
        string,
        { create?: boolean; read?: boolean }
      >,
    },
  },
}))
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => auth,
  useConfig: () => ({ config: { routes: { api: '/api', admin: '/admin' } } }),
}))
vi.mock('@/review/Tasks', () => ({
  Tasks: ({ renderList }: { renderList: (props: object) => unknown }) =>
    renderList({ onSelect: select, refreshKey: 0 }),
}))
vi.mock('@/review/BoardIcon', () => ({
  BoardIcon: ({ name }: { name: string }) => <span aria-label={`Board icon for ${name}`} />,
}))
vi.mock('@/review/client', async () => ({
  ...(await vi.importActual<typeof import('@/review/client')>('@/review/client')),
  reviewAPI: vi.fn(),
}))
const network = vi.mocked(reviewAPI)
const collections = ['posts', 'pages', 'review-tasks']
beforeEach(() => {
  // The shared admin provider binds the dashboard URL before widgets mount.
  window.history.replaceState({}, '', '/admin?site=default')
  delete auth.permissions.collections['task-projects']
  delete auth.permissions.collections['task-boards']
  select.mockReset()
  network.mockReset()
  network.mockImplementation(async (_api, url) => {
    const params = new URLSearchParams(url.split('?')[1])
    const where = params.get('where') || ''
    if (url.includes('/count?'))
      return {
        totalDocs: url.startsWith('review-tasks')
          ? 24
          : where.includes('published') || url.includes('equals]=draft')
            ? 53
            : 0,
      } as never
    if (url.startsWith('review-tasks?'))
      return {
        docs: where.includes('"exists":true')
          ? [{ id: 9, title: 'Check heading', status: 'open', dueDate: '2026-01-01T12:00:00Z' }]
          : [],
      } as never
    if (url.includes('/versions?')) return { docs: [{ parent: 1 }] } as never
    return {
      docs: [
        {
          id: 1,
          title: url.startsWith('posts?') ? 'Recent post' : 'Newer page',
          _status: 'draft',
          updatedAt: url.startsWith('posts?') ? '2026-10-17T10:00:00Z' : '2026-10-17T11:00:00Z',
        },
      ],
    } as never
  })
})
afterEach(cleanup)
describe('Personal Dashboard widgets', () => {
  it('shows hidden workspace collections through read permissions, full counts, favorites, and protected project labels', async () => {
    auth.permissions.collections['task-projects'] = { read: true }
    auth.permissions.collections['task-boards'] = { read: true }
    network.mockImplementation(async (_api, url) => {
      if (url.startsWith('task-projects/count')) return { totalDocs: 37 } as never
      if (url.startsWith('task-boards/count')) return { totalDocs: 52 } as never
      if (url.startsWith('task-projects/99'))
        throw Object.assign(new Error('Forbidden'), { status: 403 })
      if (url.startsWith('task-projects?'))
        return {
          docs: [{ id: 1, name: 'Work', ownerLabel: 'Alex', updatedAt: '2026-10-19T10:00:00Z' }],
        } as never
      if (url.startsWith('task-boards?'))
        return {
          docs: [
            {
              id: 2,
              name: url.includes('favoriteUser') ? 'Favorite board' : 'Recent board',
              project: 99,
              updatedAt: '2026-10-19T10:00:00Z',
            },
          ],
        } as never
      return url.includes('/count?') ? ({ totalDocs: 0 } as never) : ({ docs: [] } as never)
    })
    render(<DashboardClient collections={[]} />)
    expect((await screen.findByRole('link', { name: /Active projects/ })).textContent).toContain(
      '37',
    )
    expect((await screen.findByRole('link', { name: /Active boards/ })).textContent).toContain('52')
    expect(
      (await screen.findByRole('link', { name: 'Recent board' })).getAttribute('href'),
    ).toContain('workspace=boards&board=2')
    expect(screen.getByRole('link', { name: 'Work' }).getAttribute('href')).toContain(
      'workspace=projects&project=1',
    )
    expect(screen.queryByText('Forbidden')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    await screen.findByRole('link', { name: 'Favorite board' })
    const list = network.mock.calls.find(
      ([, url]) => url.startsWith('task-boards?') && url.includes('favoriteUser'),
    )!
    const params = new URLSearchParams(list[1].split('?')[1])
    expect(params.get('limit')).toBe('6')
    expect(params.get('sort')).toBe('-updatedAt,-id')
    expect(params.get('where')).toContain('project.archived')
    expect(params.get('where')).toContain('"equals":"7"')
  })
  it('keeps project failures independent and removes stale board names after revoked access', async () => {
    auth.permissions.collections['task-projects'] = { read: true }
    auth.permissions.collections['task-boards'] = { read: true }
    let revoked = false
    network.mockImplementation(async (_api, url) => {
      if (url.startsWith('task-projects?')) throw new Error('Provider failure')
      if (url.startsWith('task-boards?')) {
        if (revoked) throw Object.assign(new Error('Forbidden'), { status: 403 })
        return {
          docs: [{ id: 2, name: 'Private work', updatedAt: '2026-10-19T10:00:00Z' }],
        } as never
      }
      return url.includes('/count?') ? ({ totalDocs: 0 } as never) : ({ docs: [] } as never)
    })
    render(<DashboardClient collections={[]} />)
    await screen.findByRole('link', { name: 'Private work' })
    expect(within(screen.getByRole('region', { name: 'Projects' })).getByRole('alert')).toBeTruthy()
    revoked = true
    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Private work' })).toBeNull())
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Boards' })).getByRole('alert'),
      ).toBeTruthy(),
    )
  })
  it('uses full native counts, mixed draft ordering and permission-aware create links', async () => {
    render(<DashboardClient collections={collections} />)
    await screen.findByRole('link', { name: 'Newer page' })
    expect(screen.getByRole('heading', { name: 'Welcome back, Alex' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '+ New post' }).getAttribute('href')).toBe(
      '/admin/collections/posts/create',
    )
    expect(screen.queryByRole('link', { name: '+ New page' })).toBeNull()
    expect(screen.getByRole('link', { name: /Published posts/ }).textContent).toContain('53')
    const recent = screen.getByRole('region', { name: 'Recently updated content' })
    expect(
      within(recent)
        .getAllByRole('listitem')
        .map((row) => row.textContent?.split('·')[0]),
    ).toEqual(['Newer pagePage ', 'Recent postPost '])
    expect(within(recent).getAllByText('Changed')).toHaveLength(2)
    expect(
      network.mock.calls.some(([, url]) => url.startsWith('pages?') && url.includes('draft=true')),
    ).toBe(true)
  })
  it('queries personal tasks with deadlines first, opens the shared editor and links personal presets', async () => {
    render(<DashboardClient collections={collections} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Check heading' }))
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
    const tasks = screen.getByRole('region', { name: 'My tasks' })
    const overdue = within(tasks).getByRole('link', { name: /Overdue/ })
    expect(overdue.getAttribute('href')).toContain('taskView=assigned&due=overdue&page=1')
    const dated = network.mock.calls.find(([, url]) => url.includes('sort=dueDate'))!
    const params = new URLSearchParams(dated[1].split('?')[1])
    expect(params.get('sort')).toBe('dueDate,-updatedAt')
    expect(params.get('where')).toContain('"assignee":{"equals":"7"}')
    expect(params.get('where')).toContain('"status":{"not_equals":"done"}')
    expect(params.get('where')).toContain('"archived":{"equals":false}')
    expect(within(tasks).getByRole('link', { name: /Unfinished/ }).textContent).toContain('24')
  })
  it('keeps widget failures independent, supports retry and refreshes on return', async () => {
    network.mockImplementation(async (_api, url) => {
      if (url.startsWith('posts?')) throw new Error('Unavailable')
      return url.includes('/count?') ? ({ totalDocs: 0 } as never) : ({ docs: [] } as never)
    })
    render(<DashboardClient collections={collections} />)
    await screen.findByRole('alert')
    expect(screen.getByText(/all caught up/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Published pages/ }).textContent).toContain('0')
    const calls = network.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(network.mock.calls.length).toBeGreaterThan(calls))
    const afterRetry = network.mock.calls.length
    fireEvent.focus(window)
    await waitFor(() => expect(network.mock.calls.length).toBeGreaterThan(afterRetry))
  })
  it('does not request hidden collections and lets content tabs refine the recent list', async () => {
    render(<DashboardClient collections={['pages']} />)
    await screen.findByRole('link', { name: 'Newer page' })
    expect(
      network.mock.calls.some(
        ([, url]) => url.startsWith('posts') || url.startsWith('review-tasks'),
      ),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    )
  })
})
