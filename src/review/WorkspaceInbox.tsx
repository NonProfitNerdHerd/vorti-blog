'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Refresh the remote inbox when filters change. */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import './inbox-badge.css'
import { query, reviewAPI, type Task } from './client'

export function InboxBadge({ api, showZero = false }: { api: string; showZero?: boolean }) {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let current = true
    const load = async () => {
      await reviewAPI(api, 'review-tasks/notifications/sync', 'POST', {})
      const result = await reviewAPI<{ totalDocs: number }>(
        api,
        `task-notifications/count?${query({ read: { not_equals: true } })}`,
      )
      if (current) setCount(result.totalDocs)
    }
    const refresh = (): void => {
      void load().catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    window.addEventListener('vorti-tasks-changed', refresh)
    return () => {
      current = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('vorti-tasks-changed', refresh)
    }
  }, [api])
  return count !== null && (count > 0 || showZero) ? (
    <span className="task-inbox-badge" aria-label={`${count} unread notifications`}>
      {count > 99 ? '99+' : count}
    </span>
  ) : null
}

type Notice = {
  id: number
  task?: number
  board?: number
  comment?: number
  request?: number
  project?: number
  thread?: number
  projectChange?: number
  message: string
  read?: boolean
  createdAt: string
}
export function WorkspaceInbox({
  api,
  admin,
  onSelect,
}: {
  api: string
  admin: string
  onSelect: (task: Task) => void
}) {
  const [items, setItems] = useState<Notice[]>([]),
    [unread, setUnread] = useState(true),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setError('')
    try {
      await reviewAPI(api, 'review-tasks/notifications/sync', 'POST', {})
      const result = await reviewAPI<{ docs: Notice[]; totalPages: number }>(
        api,
        `task-notifications?${query(unread ? { read: { not_equals: true } } : {}, { page: String(page), limit: '20' })}`,
      )
      setItems(result.docs)
      setPages(result.totalPages)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, unread, page])
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 30000)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [load])
  const mark = async (item: Notice) => {
    await reviewAPI(api, `task-notifications/${item.id}`, 'PATCH', { read: true })
    window.dispatchEvent(new Event('vorti-tasks-changed'))
  }
  return (
    <section className="task-workspace-panel">
      <header className="task-workspace-heading">
        <div>
          <h2>Inbox</h2>
          <p>Mentions, assignments, and conversations that need you.</p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => {
              setUnread(e.target.checked)
              setPage(1)
            }}
          />{' '}
          Unread only
        </label>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </header>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {!items.length && !error && <p>You’re all caught up.</p>}
      <ul className="task-notices">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.message}</strong>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
              {item.task ? (
                <button
                  type="button"
                  onClick={() => {
                    void reviewAPI<Task>(api, `review-tasks/${item.task}?depth=0`)
                      .then(async (task) => {
                        const url = new URL(location.href)
                        url.searchParams.set('task', String(item.task))
                        if (item.comment) url.searchParams.set('comment', String(item.comment))
                        history.replaceState(null, '', url)
                        onSelect(task)
                        await mark(item)
                        await load()
                      })
                      .catch((e) => setError(e.message))
                  }}
                >
                  Open task{item.comment ? ' and comment' : ''}
                </button>
              ) : item.board ? (
                <Link
                  href={`${admin}/collections/review-tasks?workspace=boards&board=${item.board}${item.thread ? `&view=messages&thread=${item.thread}` : ''}`}
                  onClick={() => void mark(item)}
                >
                  Open board
                </Link>
              ) : item.project || item.projectChange ? (
                <Link
                  href={`${admin}/collections/review-tasks?workspace=projects${item.project ? `&project=${item.project}` : ''}`}
                  onClick={() => void mark(item)}
                >
                  {item.projectChange ? 'Review sharing request' : 'Open project'}
                </Link>
              ) : null}
            </div>
            {!item.read && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void mark(item)
                    .then(load)
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false))
                }}
              >
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
      <nav aria-label="Inbox pages">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          {page} / {Math.max(1, pages)}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </nav>
    </section>
  )
}
