'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize authenticated timer snapshots and log pages. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@payloadcms/ui'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { reviewAPI, type Task } from './client'
import { workspaceDialog } from './WorkspaceDialogs'
import { localTimeInput, parseLocalTime } from './workspace-dates'

type Snapshot = {
  totals: Record<string, number>
  activeTimer: { id: number; task?: number; startedAt: string; updatedAt: string } | null
  asOf: string
}
function duration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 3600)}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}
type Control = {
  api: string
  snapshot?: Snapshot
  loading: boolean
  busy: boolean
  error: string
  mutate: (id: number, data: Record<string, unknown>) => Promise<void>
  refresh: () => Promise<void>
}
const TimeContext = createContext<Control | null>(null)
export function WorkTimeProvider({
  api,
  board,
  tasks,
  onChanged,
  children,
}: {
  api: string
  board?: string
  tasks: Task[]
  onChanged: () => Promise<void> | void
  children: ReactNode
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const ids = tasks
      .map((task) => task.id)
      .sort((a, b) => a - b)
      .join(','),
    sequence = useRef(0),
    pending = useRef<{ signature: string; key: string } | null>(null)
  const refresh = useCallback(async () => {
    const generation = ++sequence.current
    try {
      let next: Snapshot | undefined
      if (board) {
        const all = ids.split(',').filter(Boolean)
        for (let offset = 0; offset < Math.max(1, all.length); offset += 40) {
          const result = await reviewAPI<Snapshot>(
            api,
            `task-workspace/boards/${board}/time?ids=${all.slice(offset, offset + 40).join(',')}`,
          )
          next = next ? { ...result, totals: { ...next.totals, ...result.totals } } : result
        }
      } else if (ids) {
        const result = await reviewAPI<any>(
          api,
          `task-workspace/tasks/${ids.split(',')[0]}/time?limit=50`,
        )
        next = {
          totals: { [ids.split(',')[0]]: result.seconds },
          activeTimer: result.activeTimer,
          asOf: result.asOf,
        }
      }
      if (generation === sequence.current) {
        setSnapshot(next)
        setError('')
      }
    } catch (error) {
      if (generation === sequence.current) {
        setError((error as Error).message)
        setSnapshot(undefined)
      }
    } finally {
      if (generation === sequence.current) setLoading(false)
    }
  }, [api, board, ids])
  useEffect(() => {
    setLoading(true)
    void refresh()
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(visible, 15000)
    window.addEventListener('focus', visible)
    window.addEventListener('vorti-time-changed', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      sequence.current++
      clearInterval(timer)
      window.removeEventListener('focus', visible)
      window.removeEventListener('vorti-time-changed', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refresh])
  const mutate = async (id: number, data: Record<string, unknown>) => {
    if (busy) throw new Error('Another time change is saving. Wait, then retry.')
    setBusy(true)
    setError('')
    const signature = JSON.stringify([id, data])
    if (pending.current?.signature !== signature)
      pending.current = { signature, key: crypto.randomUUID() }
    try {
      await reviewAPI(api, `task-workspace/tasks/${id}`, 'POST', {
        ...data,
        operationKey: pending.current!.key,
      })
      pending.current = null
      await refresh()
      await onChanged()
      window.dispatchEvent(new Event('vorti-time-changed'))
    } catch (error) {
      setError((error as Error).message)
      throw error
    } finally {
      setBusy(false)
    }
  }
  return (
    <TimeContext.Provider value={{ api, snapshot, loading, busy, error, mutate, refresh }}>
      {children}
    </TimeContext.Provider>
  )
}
function useClock() {
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return clock
}
export function TimeTrackingCell({ task, fallback = 0 }: { task: Task; fallback?: number }) {
  const controller = useContext(TimeContext),
    [open, setOpen] = useState(false),
    clock = useClock()
  if (!controller) return <output>{duration(fallback)}</output>
  const { snapshot, busy, loading } = controller,
    active = snapshot?.activeTimer,
    running = active?.task === task.id
  const seconds =
    (snapshot?.totals[task.id] ?? fallback) +
    (running ? Math.max(0, Math.floor((clock - Date.parse(snapshot!.asOf)) / 1000)) : 0)
  return (
    <div className="workspace-time-cell">
      <button
        type="button"
        className="workspace-bare-control"
        aria-label={`${running ? 'Pause' : 'Start'} time for ${task.title}`}
        disabled={!task.canEdit || busy || loading || !snapshot}
        onClick={() => {
          if (active && !running)
            void workspaceDialog({
              title: 'Switch running timer?',
              description: 'Pause your current work session and start tracking this task.',
              fields: [],
              saveLabel: 'Switch timer',
              onSave: () =>
                controller.mutate(task.id, {
                  action: 'switch-time',
                  expectedUpdatedAt: active.updatedAt,
                }),
            })
          else
            void controller
              .mutate(
                task.id,
                running
                  ? { action: 'stop-time', entry: active!.id, expectedUpdatedAt: active!.updatedAt }
                  : { action: 'start-time' },
              )
              .catch(() => {})
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
          <path d={running ? 'M6 4h4v16H6ZM14 4h4v16h-4Z' : 'M6 3v18l15-9Z'} />
        </svg>
      </button>
      <output
        aria-label={`Total time for ${task.title}`}
        title={`${(seconds / 3600).toFixed(2)} hours`}
      >
        {duration(seconds)}
      </output>
      <button
        type="button"
        className="workspace-bare-control"
        aria-label={`Time log for ${task.title}`}
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="m4 16 12-12 4 4L8 20H4Z M14 6l4 4" />
        </svg>
      </button>
      {controller.error && (
        <span role="alert" className="workspace-time-error">
          {controller.error}
          <button type="button" onClick={() => void controller.refresh()}>
            Reload timer
          </button>
        </span>
      )}
      {open && <TimeLogDialog task={task} controller={controller} onClose={() => setOpen(false)} />}
    </div>
  )
}
export function TaskTimeControls({
  api,
  task,
  onChanged,
}: {
  api: string
  task: Task
  onChanged: () => Promise<void> | void
}) {
  return (
    <WorkTimeProvider api={api} tasks={[task]} onChanged={onChanged}>
      <TimeTrackingCell task={task} />
    </WorkTimeProvider>
  )
}
export function TaskTimeLog({
  api,
  task,
  onChanged,
  onClose,
}: {
  api: string
  task: Task
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  return (
    <WorkTimeProvider api={api} tasks={[task]} onChanged={onChanged}>
      <StandaloneLog task={task} onClose={onClose} />
    </WorkTimeProvider>
  )
}
function StandaloneLog({ task, onClose }: { task: Task; onClose: () => void }) {
  return <TimeLogDialog task={task} controller={useContext(TimeContext)!} onClose={onClose} />
}
function TimeLogDialog({
  task,
  controller,
  onClose,
}: {
  task: Task
  controller: Control
  onClose: () => void
}) {
  const { user } = useAuth(),
    [tab, setTab] = useState('log'),
    [page, setPage] = useState(1),
    [data, setData] = useState<any>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    clock = useClock()
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(
        await reviewAPI(
          controller.api,
          `task-workspace/tasks/${task.id}/time?limit=50&page=${page}${tab === 'history' ? '&tab=history' : ''}`,
        ),
      )
      setError('')
    } catch (error) {
      setError((error as Error).message)
      setData(undefined)
    } finally {
      setLoading(false)
    }
  }, [controller.api, task.id, page, tab])
  useEffect(() => {
    void load()
    window.addEventListener('vorti-time-changed', load)
    return () => window.removeEventListener('vorti-time-changed', load)
  }, [load])
  const correct = (entry?: any): void =>
    void workspaceDialog({
      title: entry ? 'Correct time entry' : 'Add time manually',
      description: 'Enter times in your local timezone. Reports use the site timezone.',
      fields: [
        {
          name: 'start',
          label: 'Started',
          type: 'datetime-local',
          value: entry ? localTimeInput(entry.startedAt) : '',
          required: true,
        },
        {
          name: 'end',
          label: 'Ended',
          type: 'datetime-local',
          value: entry ? localTimeInput(entry.endedAt) : '',
          required: true,
        },
        { name: 'note', label: 'Notes', value: entry?.note ?? '' },
        {
          name: 'reason',
          label: 'Reason for correction',
          required: !!entry && entry.user !== user?.id,
        },
      ],
      onSave: async (values) => {
        await controller.mutate(task.id, {
          action: 'save-time',
          ...(entry ? { entry: entry.id, expectedUpdatedAt: entry.updatedAt } : {}),
          startedAt:
            entry && values.start === localTimeInput(entry.startedAt)
              ? entry.startedAt
              : parseLocalTime(values.start),
          endedAt:
            entry && values.end === localTimeInput(entry.endedAt)
              ? entry.endedAt
              : parseLocalTime(values.end),
          note: values.note,
          reason: values.reason,
        })
        await load()
      },
    })
  const pages = Math.max(1, data?.totalPages ?? 1, data?.legacy?.totalPages ?? 1)
  return (
    <EditorDialog open title={`Time tracking — ${task.title}`} onClose={onClose}>
      <div className="workspace-time-dialog">
        <nav aria-label="Time tracking tabs">
          <button
            type="button"
            aria-pressed={tab === 'log'}
            onClick={() => {
              setTab('log')
              setPage(1)
            }}
          >
            Time log
          </button>
          <button
            type="button"
            aria-pressed={tab === 'history'}
            onClick={() => {
              setTab('history')
              setPage(1)
            }}
          >
            Change history
          </button>
        </nav>
        <p>
          Totals include everyone’s recorded and running time. Detailed entries follow workspace
          permissions.
        </p>
        <div className="workspace-time-pagination">
          <button
            type="button"
            aria-label="Previous time page"
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            aria-label="Next time page"
            disabled={page >= pages || loading}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
          {tab === 'log' && task.canEdit && (
            <button type="button" className="task-primary" onClick={() => correct()}>
              Add time manually
            </button>
          )}
        </div>
        {loading && <p role="status">Loading time records…</p>}
        {error && (
          <p role="alert">
            {error}
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </p>
        )}
        <div className="workspace-table-scroll">
          {tab === 'log' ? (
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Duration</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.entries?.map((entry: any) => (
                  <tr key={entry.id}>
                    <td>{entry.userLabel}</td>
                    <td>
                      {new Date(entry.startedAt).toLocaleString(undefined, {
                        timeZone: data.timezone,
                      })}
                    </td>
                    <td>
                      {entry.endedAt
                        ? new Date(entry.endedAt).toLocaleString(undefined, {
                            timeZone: data.timezone,
                          })
                        : 'Running'}
                    </td>
                    <td>
                      {duration(
                        entry.endedAt
                          ? entry.seconds
                          : Math.max(0, (clock - Date.parse(entry.startedAt)) / 1000),
                      )}
                    </td>
                    <td>{entry.note}</td>
                    <td>
                      {entry.canEdit && (
                        <button type="button" onClick={() => correct(entry)}>
                          Edit entry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && !data?.entries?.length && (
                  <tr>
                    <td colSpan={6}>No visible time entries.</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Edited by</th>
                    <th>Action</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.docs?.map((entry: any) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td>{entry.actorLabel}</td>
                      <td>{entry.action}</td>
                      <td>
                        <TimeSnapshot value={entry.beforeValue} />
                      </td>
                      <td>
                        <TimeSnapshot value={entry.afterValue} />
                      </td>
                      <td>{entry.reason}</td>
                    </tr>
                  ))}
                  {!loading && !data?.docs?.length && (
                    <tr>
                      <td colSpan={6}>No change history yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {data?.legacy?.docs?.length > 0 && (
                <section>
                  <h3>Legacy corrections</h3>
                  <p>
                    Historical records did not capture complete after-values. These records are
                    read-only.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Edited by</th>
                        <th>Before</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.legacy.docs.map((row: any, index: number) => (
                        <tr key={index}>
                          <td>{row.at ? new Date(row.at).toLocaleString() : 'Not recorded'}</td>
                          <td>{row.actorLabel}</td>
                          <td>
                            <TimeSnapshot value={row.previous} />
                          </td>
                          <td>{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </EditorDialog>
  )
}
function TimeSnapshot({ value }: { value: any }) {
  return value ? (
    <span>
      {value.startedAt ? new Date(value.startedAt).toLocaleString() : ''} →{' '}
      {value.endedAt ? new Date(value.endedAt).toLocaleString() : 'Running'} ·{' '}
      {value.seconds === undefined ? 'Duration not recorded' : duration(value.seconds)}
      {value.note ? ` · ${value.note}` : ''}
    </span>
  ) : (
    <span>—</span>
  )
}
