// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardClient } from '@/dashboard/DashboardClient'
import { reviewAPI } from '@/review/client'

const { select, auth } = vi.hoisted(() => ({
  select: vi.fn(),
  auth: {
    user: { id: 7, displayName: 'Alex Smith' },
    permissions: { collections: { posts: { create: true }, pages: { create: false } } },
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
vi.mock('@/review/client', async () => ({
  ...(await vi.importActual<typeof import('@/review/client')>('@/review/client')),
  reviewAPI: vi.fn(),
}))
const network = vi.mocked(reviewAPI)
const collections = ['posts', 'pages', 'review-tasks']
beforeEach(() => {
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
