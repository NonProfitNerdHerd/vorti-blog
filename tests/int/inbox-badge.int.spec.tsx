// DOM environment is selected by the dom Vitest project.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ count: 0, fail: false }))
vi.mock('../../src/review/client', () => ({
  query: () => 'where[read][not_equals]=true',
  reviewAPI: vi.fn(async (_api: string, path: string, method?: string) => {
    if (state.fail) throw Error('Unavailable')
    if (method === 'PATCH') { state.count = 0; return {} }
    if (path.includes('/count?')) return { totalDocs: state.count }
    if (path.startsWith('task-notifications?')) return {
      docs: state.count ? [{ id: 1, message: 'Assigned to you', createdAt: '2026-10-26T12:00:00Z' }] : [], totalPages: 1,
    }
    return {}
  }),
}))
import { InboxBadge, WorkspaceInbox } from '../../src/review/WorkspaceInbox'
afterEach(() => { cleanup(); state.count = 0; state.fail = false; vi.clearAllMocks() })
it('shows a confirmed zero and caps large counts without changing the accessible unread count', async () => {
  render(<InboxBadge api="/api" showZero />)
  await waitFor(() => expect(screen.getByLabelText('0 unread notifications').textContent).toBe('0'))
  state.count = 125
  fireEvent(window, new Event('vorti-tasks-changed'))
  await waitFor(() => expect(screen.getByLabelText('125 unread notifications').textContent).toBe('99+'))
  state.fail = true
  fireEvent(window, new Event('focus'))
  expect(screen.getByLabelText('125 unread notifications').textContent).toBe('99+')
})
it('refreshes the sidebar count when an inbox item is marked read', async () => {
  state.count = 1
  render(<><InboxBadge api="/api" showZero /><WorkspaceInbox api="/api" admin="/admin" onSelect={() => {}} /></>)
  await waitFor(() => expect(screen.getByLabelText('1 unread notifications').textContent).toBe('1'))
  fireEvent.click(await screen.findByRole('button', { name: 'Mark read' }))
  await waitFor(() => expect(screen.getByLabelText('0 unread notifications').textContent).toBe('0'))
  expect(screen.queryByText('Assigned to you')).toBeNull()
})
it('does not claim an empty inbox when the count request fails', async () => {
  state.fail = true
  const { container } = render(<InboxBadge api="/api" showZero />)
  await waitFor(() => expect(container.textContent).toBe(''))
})
