'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Refresh independent authorized workspace widgets. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useAuth } from '@payloadcms/ui'
import { BoardIcon } from './BoardIcon'
import { query, reviewAPI, type Task } from './client'
import { localTaskDay } from './dashboard-model'
import { loadPersonalTasks } from './personal-tasks'
import type { Board } from './WorkspaceBoards'

const active = {
  and: [
    { archived: { not_equals: true } },
    { or: [{ project: { exists: false } }, { 'project.archived': { not_equals: true } }] },
  ],
}
function Widget<T>({
  title,
  load,
  children,
  version,
}: {
  title: string
  load: () => Promise<T>
  children: (data: T) => ReactNode
  version: number
}) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setBusy(true)
    setError('')
    void load().then(
      (data) => {
        if (current) {
          setData(data)
          setBusy(false)
        }
      },
      () => {
        if (current) {
          setData(undefined)
          setError('Could not load this section.')
          setBusy(false)
        }
      },
    )
    return () => {
      current = false
    }
  }, [load, version, retry])
  return (
    <section className="workspace-home-panel">
      <h2>{title}</h2>
      {busy ? (
        <p role="status">Loading…</p>
      ) : error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      ) : (
        data && children(data)
      )}
    </section>
  )
}
export function WorkspaceHome({
  api,
  admin,
  onSelect,
  refreshKey,
}: {
  api: string
  admin: string
  onSelect: (task: Task) => void
  refreshKey: number
}) {
  const { user } = useAuth(),
    [version, setVersion] = useState(0),
    [today, setToday] = useState(localTaskDay)
  useEffect(() => {
    const refresh = () => {
      setToday(localTaskDay())
      setVersion((n) => n + 1)
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('vorti-tasks-changed', refresh)
    const clock = window.setInterval(() => {
      if (localTaskDay() !== today) refresh()
    }, 60000)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('vorti-tasks-changed', refresh)
      clearInterval(clock)
    }
  }, [today])
  const base = `${admin}/collections/review-tasks`
  const personal = useCallback(
    () => loadPersonalTasks(api, String(user?.id), today),
    [api, user?.id, today],
  )
  const favorites = useCallback(
    async () =>
      (
        await reviewAPI<{ docs: Board[] }>(
          api,
          `task-boards?${query({ and: [...active.and, { 'preferences.favoriteUser': { equals: user?.id } }] }, { limit: '6', sort: 'name' })}`,
        )
      ).docs,
    [api, user?.id],
  )
  const recent = useCallback(
    async () =>
      (await reviewAPI<{ docs: Board[] }>(api, `task-boards?${query(active, { limit: '6' })}`))
        .docs,
    [api],
  )
  const boards = (items: Board[]) =>
    !items.length ? (
      <p>
        No boards to show yet. <Link href={`${base}?workspace=boards`}>Browse boards</Link>
      </p>
    ) : (
      <ul className="workspace-home-boards">
        {items.map((board) => (
          <li key={board.id}>
            <BoardIcon api={api} board={board.id} name={board.name} />
            <Link href={`${base}?workspace=boards&board=${board.id}`}>{board.name}</Link>
          </li>
        ))}
      </ul>
    )
  return (
    <div className="workspace-home">
      <div className="workspace-home-heading">
        <h2>Home</h2>
        <button type="button" onClick={() => setVersion((n) => n + 1)}>
          Refresh Home
        </button>
      </div>
      <Widget title="My work" load={personal} version={version + refreshKey}>
        {({ docs, counts }) => (
          <>
            <p>Personal Tasks stay in the tenant where they were created. Tenant Administrators can read them; administrator access is audited.</p>
            <div className="workspace-home-counts">
              {['Unfinished', 'Overdue', 'Due soon'].map((label, index) => (
                <Link
                  key={label}
                  href={`${base}?taskView=assigned&due=${['', 'overdue', 'soon'][index]}&page=1&limit=10`}
                >
                  <strong>{counts[index]}</strong>
                  {label}
                </Link>
              ))}
            </div>
            <h3>Upcoming assigned tasks</h3>
            {!docs.length && <p>You’re all caught up.</p>}
            <ul className="workspace-home-tasks">
              {docs.map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={() => onSelect(task)}>
                    {task.title}
                  </button>
                  <span>{task.dueDate?.slice(0, 10) || 'No due date'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Widget>
      <div className="workspace-home-grid">
        <Widget title="Favorite boards" load={favorites} version={version}>
          {boards}
        </Widget>
        <Widget title="Recently updated boards" load={recent} version={version}>
          {boards}
        </Widget>
      </div>
    </div>
  )
}
