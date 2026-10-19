'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize authorized records and inline drafts. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Board } from './WorkspaceBoards'
import type { Task } from './client'
import { reviewAPI } from './client'
import { boardProgress } from './board-overview-model'
import type { BoardActivityItem } from './board-overview-service'

export type AccessPerson = {
  id: number
  label: string
  username?: string
  avatar?: string
  role?: string
}
export const personName = (person: AccessPerson) =>
  person.username ? `@${person.username}` : person.label
export function PersonAvatar({ person }: { person: AccessPerson }) {
  const name = personName(person)
  return (
    <span className="workspace-person-avatar" title={name} aria-label={name} tabIndex={0}>
      {person.avatar ? (
        <img src={person.avatar} alt="" />
      ) : (
        <span aria-hidden="true">
          {(person.username || person.label)
            .split(/[\s._-]+/)
            .map((part) => part[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </span>
      )}
      <span className="workspace-person-tooltip" role="tooltip">
        {name}
      </span>
    </span>
  )
}

export function BoardAbout({
  api,
  board,
  tasks,
  complete,
  editable,
  onSaved,
  onDirty,
}: {
  api: string
  board: Board
  tasks: Task[]
  complete: boolean
  editable: boolean
  onSaved: () => Promise<void>
  onDirty: (dirty: boolean) => void
}) {
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(board.description ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const original = useRef(board.description ?? '')
  useEffect(() => {
    if (!editing) {
      setText(board.description ?? '')
      original.current = board.description ?? ''
    }
  }, [board.description, editing])
  useEffect(() => {
    const dirty = editing && text !== original.current
    onDirty(dirty)
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    const navigate = (event: MouseEvent) => {
      if (
        dirty &&
        (event.target as Element).closest('a[href]') &&
        !confirm('Discard unsaved description changes?')
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', navigate, true)
    return () => {
      onDirty(false)
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', navigate, true)
    }
  }, [editing, text, onDirty])
  const progress = boardProgress(tasks),
    total = tasks.length
  const labels = {
    done: 'Completed',
    overdue: 'Overdue',
    upcoming: 'Due within seven days',
    remaining: 'Other unfinished',
  }
  const description = Object.entries(progress)
    .map(([key, count]) => `${count} ${labels[key as keyof typeof labels].toLowerCase()}`)
    .join(', ')
  return (
    <>
      <header className="workspace-about-heading">
        <h3>About this board</h3>
        <div className="workspace-board-progress">
          <span>
            {complete
              ? `${progress.done} of ${total} tasks completed`
              : 'Loading completion totals…'}
          </span>
          <div
            className="workspace-progress-track"
            role="img"
            aria-label={complete ? description : 'Loading task progress'}
          >
            {complete &&
              Object.entries(progress).map(
                ([key, count]) =>
                  count > 0 && (
                    <span
                      key={key}
                      className={`workspace-progress-${key}`}
                      style={{ width: `${(count / total) * 100}%` }}
                      title={`${labels[key as keyof typeof labels]}: ${count}`}
                    />
                  ),
              )}
          </div>
          {complete && total > 0 && (
            <div className="workspace-progress-legend">
              {Object.entries(progress).map(
                ([key, count]) =>
                  count > 0 && (
                    <span key={key}>
                      <i className={`workspace-progress-${key}`} />
                      {labels[key as keyof typeof labels]} {count}
                    </span>
                  ),
              )}
            </div>
          )}
        </div>
      </header>
      {editing ? (
        <form
          className="workspace-inline-description"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setBusy(true)
            setError('')
            try {
              await reviewAPI(api, `task-boards/${board.id}`, 'PATCH', {
                description: text,
                expectedUpdatedAt: board.updatedAt,
              })
              onDirty(false)
              setEditing(false)
              setNotice('Board description saved.')
              await onSaved()
            } catch (error) {
              setError((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <label htmlFor={`board-description-${board.id}`}>Board description</label>
          <textarea
            id={`board-description-${board.id}`}
            autoFocus
            value={text}
            maxLength={10000}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                event.preventDefault()
                if (text === original.current || confirm('Discard unsaved description changes?')) {
                  setEditing(false)
                  onDirty(false)
                  setError('')
                }
              }
            }}
          />
          {error && (
            <p role="alert">
              {error} Your description is still here.{' '}
              <button type="button" onClick={() => void onSaved()}>
                Reload board
              </button>
            </p>
          )}
          <div>
            <button type="submit" className="task-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save description'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (text === original.current || confirm('Discard unsaved description changes?')) {
                  setEditing(false)
                  onDirty(false)
                  setError('')
                }
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : editable ? (
        <button
          type="button"
          className="workspace-description-display"
          aria-label="Edit board description"
          onClick={() => {
            setEditing(true)
            setNotice('')
          }}
        >
          {board.description || 'Add a description…'}
        </button>
      ) : (
        <p className="workspace-description-display">
          {board.description || 'No description yet.'}
        </p>
      )}
      {notice && (
        <p className="workspace-description-notice" role="status">
          {notice}
        </p>
      )}
      <p className="workspace-board-dates">
        First start:{' '}
        {tasks
          .map((task) => task.startDate?.slice(0, 10))
          .filter(Boolean)
          .sort()[0] || 'Not scheduled'}{' '}
        · Latest deadline:{' '}
        {tasks
          .map((task) => task.dueDate?.slice(0, 10))
          .filter(Boolean)
          .sort()
          .at(-1) || 'Not scheduled'}
      </p>
    </>
  )
}

export function BoardActivity({
  api,
  board,
  refreshKey,
  onSelect,
  onBoardActivity,
}: {
  api: string
  board: string
  refreshKey: number | string
  onSelect: (task: Task) => void
  onBoardActivity: (item: BoardActivityItem) => void
}) {
  const [data, setData] = useState<{
      docs: BoardActivityItem[]
      totalDocs: number
      nextCursor?: string
    }>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [limit, setLimit] = useState(50),
    [positions, setPositions] = useState<string[]>(['']),
    [page, setPage] = useState(0)
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(limit), cursor: positions[page] ?? '' })
      const result = await reviewAPI<any>(api, `task-workspace/boards/${board}/activity?${params}`)
      if (current === sequence.current) setData(result)
    } catch (error) {
      if (current === sequence.current) {
        setError((error as Error).message)
        setData(undefined)
      }
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [api, board, limit, page, positions])
  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => {
      sequence.current++
      window.removeEventListener('focus', load)
    }
  }, [load, refreshKey])
  return (
    <section className="workspace-board-activity" aria-busy={loading}>
      <header>
        <h3>Recent activity</h3>
        <div className="workspace-activity-pagination">
          <button
            type="button"
            className="workspace-icon-control"
            aria-label="Previous activity page"
            disabled={page === 0 || loading}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </button>
          <span aria-live="polite">
            {data?.totalDocs
              ? `${page * limit + 1}–${Math.min(page * limit + (data?.docs.length ?? 0), data.totalDocs)} of ${data.totalDocs}`
              : '0 of 0'}
          </span>
          <button
            type="button"
            className="workspace-icon-control"
            aria-label="Next activity page"
            disabled={!data?.nextCursor || loading}
            onClick={() => {
              setPositions([...positions.slice(0, page + 1), data!.nextCursor!])
              setPage(page + 1)
            }}
          >
            ›
          </button>
          <label>
            Rows{' '}
            <select
              aria-label="Activity rows per page"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value))
                setPage(0)
                setPositions([''])
              }}
            >
              {[10, 25, 50, 100, 200].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry activity
          </button>
        </p>
      )}
      <div className="workspace-table-scroll">
        <table aria-label="Recent board and task activity, newest first">
          <thead>
            <tr>
              <th>Activity</th>
              <th>Item</th>
              <th>By</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {data?.docs.map((item) => (
              <tr key={`${item.source}:${item.id}`}>
                <td>
                  <button
                    type="button"
                    className="workspace-activity-link"
                    onClick={async () => {
                      try {
                        if (item.task) {
                          const task = await reviewAPI<Task>(
                            api,
                            `review-tasks/${item.task}?depth=0`,
                          )
                          const url = new URL(location.href)
                          url.searchParams.delete('comment')
                          url.searchParams.delete('attachment')
                          url.searchParams.set(
                            'taskTab',
                            item.comment ? 'comments' : item.attachment ? 'attachments' : 'default',
                          )
                          if (item.comment) url.searchParams.set('comment', String(item.comment))
                          if (item.attachment)
                            url.searchParams.set('attachment', String(item.attachment))
                          history.replaceState(null, '', url)
                          onSelect(task)
                        } else onBoardActivity(item)
                      } catch (error) {
                        setError((error as Error).message)
                      }
                    }}
                  >
                    {item.message}
                  </button>
                </td>
                <td>{item.title || (item.source === 'file' ? 'Board files' : 'Board')}</td>
                <td>{item.actor}</td>
                <td>
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                </td>
              </tr>
            ))}
            {!data?.docs.length && !loading && !error && (
              <tr>
                <td colSpan={4}>No activity yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <p role="status">Loading activity…</p>}
    </section>
  )
}
