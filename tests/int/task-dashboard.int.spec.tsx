// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskDashboard } from '@/review/TaskDashboard'
import { reviewAPI } from '@/review/client'

vi.mock('@/review/client', async () => ({
  ...(await vi.importActual<typeof import('@/review/client')>('@/review/client')),
  reviewAPI: vi.fn(),
}))
const task = {
  id: 1,
  title: 'Inspect footer',
  documentType: 'site-templates',
  documentID: '4',
  documentTitle: 'Main site',
  region: 'footer',
  status: 'open',
  priority: 'normal',
  assignee: 7,
  dueDate: '2026-10-17T12:00:00.000Z',
}
const select = vi.fn()
const network = vi.mocked(reviewAPI)
beforeEach(() => {
  select.mockReset()
  network.mockReset()
  window.history.replaceState({}, '', '/admin/collections/review-tasks?depth=1&page=2&limit=10')
  network.mockImplementation(async (_api, url) => {
    if (url.startsWith('review-tasks/count?')) return { totalDocs: 83 } as never
    const where = JSON.parse(new URLSearchParams(url.split('?')[1]).get('where')!)
    const empty = JSON.stringify(where).includes('nothing')
    return {
      docs: empty
        ? []
        : [task, { ...task, id: 2, title: 'Retained history', documentDeleted: true }],
      totalDocs: empty ? 0 : 42,
      totalPages: empty ? 0 : 5,
    } as never
  })
})
afterEach(cleanup)
function mount(refreshKey = 0) {
  return (
    <TaskDashboard
      api="/api"
      admin="/manage"
      userID={7}
      people={[{ id: 7, label: 'Reviewer' }]}
      refreshKey={refreshKey}
      onSelect={select}
    />
  )
}

describe('Global task dashboard', () => {
  it('uses complete server totals, URL pagination and accessible document links', async () => {
    render(mount())
    await screen.findByRole('button', { name: 'All unfinished: 83' })
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    await waitFor(() =>
      expect(
        network.mock.calls.some(([, url]) => url.includes('page=2') && url.includes('limit=10')),
      ).toBe(true),
    )
    const link = within(table).getByRole('link', { name: 'Open Main site in new tab' })
    expect(link.getAttribute('href')).toBe(
      '/manage/collections/site-templates/4?task=1&reviewRegion=footer',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(
      within(table).getByRole('button', { name: 'Document unavailable' }).hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(within(table).getByRole('button', { name: 'Inspect footer' }))
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })
  it('keeps counts independent of search and resets refinements when selecting a preset', async () => {
    render(mount())
    await screen.findByRole('button', { name: 'Assigned to me: 83' })
    const initialCounts = network.mock.calls.filter(([, url]) =>
      url.startsWith('review-tasks/count?'),
    ).length
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'nothing' } })
    await screen.findByText('No tasks match these filters.')
    expect(screen.getByRole('button', { name: 'All unfinished: 83' })).toBeTruthy()
    expect(
      network.mock.calls.filter(([, url]) => url.startsWith('review-tasks/count?')),
    ).toHaveLength(initialCounts)
    fireEvent.click(screen.getByRole('button', { name: 'Assigned to me: 83' }))
    expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Assignee') as unknown as HTMLSelectElement).value).toBe('7')
    await waitFor(() =>
      expect(
        network.mock.calls.some(([, url]) => {
          if (url.includes('/count?')) return false
          const params = new URLSearchParams(url.split('?')[1])
          return (
            params.get('page') === '1' && params.get('where')?.includes('"assignee":{"equals":"7"}')
          )
        }),
      ).toBe(true),
    )
  })
  it('refreshes counts after mutations and on focus and handles unavailable counts honestly', async () => {
    const view = render(mount())
    await screen.findByRole('button', { name: 'All unfinished: 83' })
    network.mockClear()
    view.rerender(mount(1))
    await waitFor(() =>
      expect(network.mock.calls.filter(([, url]) => url.includes('/count?'))).toHaveLength(6),
    )
    network.mockClear()
    fireEvent.focus(window)
    await waitFor(() =>
      expect(network.mock.calls.filter(([, url]) => url.includes('/count?'))).toHaveLength(6),
    )
    network.mockImplementation(async (_api, url) => {
      if (url.includes('/count?')) throw new Error('Unavailable')
      return { docs: [], totalDocs: 0, totalPages: 1 } as never
    })
    view.rerender(mount(2))
    await screen.findByText('Some summary counts are unavailable.')
    expect(screen.queryByRole('button', { name: 'All unfinished: 83' })).toBeNull()
    expect(screen.getAllByLabelText('Count unavailable')).toHaveLength(6)
  })
})
