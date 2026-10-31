'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate URL/calendar state and synchronize access-controlled remote task results. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { query, reviewAPI, statuses, type Task } from './client'
import { taskDocumentLink } from './links'
import { crmTaskSourceHref, crmTaskSourceLabel } from './CRMTaskSourcePicker'
import {
  defaultTaskFilters,
  localTaskDay,
  taskFiltersWhere,
  taskURLState,
  writeTaskURL,
  taskPresetFilters,
  taskPresets,
  type TaskFilters,
  type TaskPreset,
} from './dashboard-model'
import './task-dashboard.css'

type Person = { id: number; label: string }
type Results = { docs: Task[]; totalDocs: number; totalPages: number }
type Counts = Partial<Record<TaskPreset, number | null>>
const documentNames: Record<string, string> = {
  posts: 'Post',
  pages: 'Page',
  'design-templates': 'Design template',
  'site-templates': 'Site template',
}

function TaskIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    all: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
    assigned:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M16 10l2 2 4-4',
    created: 'M12 20H4V4h10M15 5l4-4 4 4-12 12-5 1 1-5z',
    unassigned: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17 9h5',
    overdue: 'M12 8v5m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    soon: 'M8 2v4M16 2v4M3 10h18M3 5h18v16H3zM8 14h3m3 0h2m-8 3h3',
    external: 'M14 3h7v7M10 14 21 3M10 3H3v18h18v-7',
    reset: 'm6 6 12 12M6 18 18 6',
  }
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.all} />
    </svg>
  )
}

export function TaskDashboard({
  api,
  admin,
  people,
  userID,
  refreshKey,
  onSelect,
}: {
  api: string
  admin: string
  people: Person[]
  userID?: string | number
  refreshKey: number
  onSelect: (task: Task) => void
}) {
  const [filters, setFilters] = useState<TaskFilters>(defaultTaskFilters)
  const [preset, setPreset] = useState<TaskPreset>('all')
  const [today, setToday] = useState('')
  const [ready, setReady] = useState(false)
  const [results, setResults] = useState<Results>({ docs: [], totalDocs: 0, totalPages: 1 })
  const [counts, setCounts] = useState<Counts>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [countError, setCountError] = useState(false)
  const listRequest = useRef(0),
    countRequest = useRef(0)
  const id = userID == null ? '' : String(userID)

  useEffect(() => {
    const restore = () => {
      const state = taskURLState(new URLSearchParams(location.search), id)
      setFilters(state.filters)
      setPreset(state.preset)
    }
    restore()
    setToday(localTaskDay())
    setReady(true)
    const back = restore
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [id])
  useEffect(() => {
    if (!ready) return
    const url = new URL(location.href)
    writeTaskURL(url.searchParams, filters, preset)
    window.history.replaceState(window.history.state, '', url)
  }, [ready, filters, preset])
  useEffect(() => {
    if (!today) return
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    const timer = window.setTimeout(
      () => setToday(localTaskDay()),
      midnight.getTime() - Date.now() + 100,
    )
    return () => window.clearTimeout(timer)
  }, [today])

  const loadList = useCallback(async () => {
    if (!ready) return
    const request = ++listRequest.current
    setLoading(true)
    setError('')
    try {
      const data = await reviewAPI<Results>(
        api,
        `review-tasks?${query(taskFiltersWhere(filters, today), { page: String(filters.page), limit: String(filters.limit) })}`,
      )
      if (request !== listRequest.current) return
      const lastPage = Math.max(1, data.totalPages)
      if (filters.page > lastPage) {
        setFilters((current) => ({ ...current, page: lastPage }))
        return
      }
      setResults(data)
    } catch (error) {
      if (request === listRequest.current) {
        setError((error as Error).message)
        setResults({ docs: [], totalDocs: 0, totalPages: 1 })
      }
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }, [api, filters, today, ready])
  const loadCounts = useCallback(async () => {
    if (!ready) return
    const request = ++countRequest.current
    const totals = await Promise.allSettled(
      taskPresets.map(async ({ key }) => {
        if (!id && (key === 'assigned' || key === 'created')) return 0
        const where = taskFiltersWhere(taskPresetFilters(key, id), today)
        const result = await reviewAPI<{ totalDocs: number }>(
          api,
          `review-tasks/count?${new URLSearchParams({ where: JSON.stringify(where) })}`,
        )
        return result.totalDocs
      }),
    )
    if (request !== countRequest.current) return
    setCounts(
      Object.fromEntries(
        totals.map((result, index) => [
          taskPresets[index].key,
          result.status === 'fulfilled' ? result.value : null,
        ]),
      ),
    )
    setCountError(totals.some((result) => result.status === 'rejected'))
  }, [api, id, today, ready])
  useEffect(() => {
    void loadList()
  }, [loadList, refreshKey])
  useEffect(() => {
    void loadCounts()
  }, [loadCounts, refreshKey])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      const day = localTaskDay()
      if (day !== today) {
        setToday(day)
        return
      }
      void loadList()
      void loadCounts()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadList, loadCounts, today])
  const update = (patch: Partial<TaskFilters>) =>
    setFilters((current) => ({ ...current, ...patch, page: 1 }))
  const choosePreset = (key: TaskPreset) => {
    setPreset(key)
    setFilters(taskPresetFilters(key, id, filters.limit))
  }
  const person = (user?: number) =>
    people.find((item) => item.id === user)?.label || (user ? `User ${user}` : 'Unassigned')
  const dateLabel = (value: string) =>
    new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  const totalPages = Math.max(1, results.totalPages)
  const baseView = taskPresetFilters(preset, id, filters.limit)
  const presetMatches =
    filters.status === baseView.status &&
    filters.assignee === baseView.assignee &&
    filters.creator === baseView.creator &&
    filters.due === baseView.due &&
    filters.archived === baseView.archived
  return (
    <section className="task-dashboard" aria-label="Task dashboard">
      <div className="task-dashboard__tiles" aria-label="Task views">
        {taskPresets.map(({ key, label, hint }) => (
          <button
            key={key}
            type="button"
            className={`task-dashboard__tile task-dashboard__tile--${key}`}
            aria-pressed={preset === key && presetMatches}
            aria-label={`${label}: ${counts[key] ?? 'loading'}`}
            disabled={!id && (key === 'assigned' || key === 'created')}
            onClick={() => choosePreset(key)}
          >
            <span className="task-dashboard__tile-top">
              <span className="task-dashboard__tile-icon">
                <TaskIcon name={key} />
              </span>
              <span>{label}</span>
            </span>
            <span className="task-dashboard__tile-count">
              {counts[key] == null ? (
                <span aria-label="Count unavailable">—</span>
              ) : (
                counts[key].toLocaleString()
              )}
            </span>
            <span className="task-dashboard__tile-hint">{hint}</span>
          </button>
        ))}
      </div>
      {countError && (
        <p className="task-dashboard__notice" role="status">
          Some summary counts are unavailable.{' '}
          <button type="button" onClick={() => void loadCounts()}>
            Retry counts
          </button>
        </p>
      )}
      <div className="task-dashboard__filters" aria-label="Filter tasks">
        <label className="task-dashboard__search">
          Search tasks
          <input
            type="search"
            placeholder="Find a task…"
            maxLength={120}
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
          />
        </label>
        <label>
          Status
          <select
            aria-label="Status"
            value={filters.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="active">All unfinished</option>
            <option value="">All statuses</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignee
          <select
            aria-label="Assignee"
            value={filters.assignee}
            onChange={(event) => update({ assignee: event.target.value })}
          >
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due date
          <select
            aria-label="Due date"
            value={filters.due}
            onChange={(event) => update({ due: event.target.value as TaskFilters['due'] })}
          >
            <option value="">Any date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="soon">Due soon</option>
            <option value="none">No due date</option>
            <option value="before">On or before…</option>
          </select>
        </label>
        {filters.due === 'before' && (
          <label>
            Due on or before
            <input
              type="date"
              value={filters.before}
              onChange={(event) => update({ before: event.target.value })}
            />
          </label>
        )}
        <button type="button" className="task-dashboard__reset" onClick={() => choosePreset('all')}>
          <TaskIcon name="reset" />
          Reset
        </button>
      </div>
      <details className="task-dashboard__more">
        <summary>
          More filters
          {filters.creator || filters.priority || filters.documentType || filters.archived
            ? ' · Active'
            : ''}
        </summary>
        <div className="task-dashboard__advanced">
          <label>
            Creator
            <select
              aria-label="Creator"
              value={filters.creator}
              onChange={(event) => update({ creator: event.target.value })}
            >
              <option value="">Everyone</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              aria-label="Priority"
              value={filters.priority}
              onChange={(event) => update({ priority: event.target.value })}
            >
              <option value="">All priorities</option>
              {['low', 'normal', 'high', 'urgent'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Document type
            <select
              aria-label="Document type"
              value={filters.documentType}
              onChange={(event) => update({ documentType: event.target.value })}
            >
              <option value="">All documents</option>
              {[
                ['posts', 'Posts'],
                ['pages', 'Pages'],
                ['design-templates', 'Design templates'],
                ['site-templates', 'Site templates'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="task-dashboard__checkbox">
            <input
              type="checkbox"
              checked={filters.archived}
              onChange={(event) => update({ archived: event.target.checked })}
            />
            Archived tasks only
          </label>
        </div>
      </details>
      <div className="task-dashboard__results" aria-live="polite">
        <strong>
          {loading
            ? 'Loading tasks…'
            : `${results.totalDocs.toLocaleString()} ${results.totalDocs === 1 ? 'task' : 'tasks'}`}
        </strong>
        <span>
          {presetMatches
            ? taskPresets.find((item) => item.key === preset)?.label
            : 'Custom filters'}
          {filters.archived ? ' · Archived' : ''}
        </span>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void loadList()}>
            Try again
          </button>
        </p>
      )}
      <div
        className="task-dashboard__table-scroll"
        role="region"
        aria-label="Tasks table"
        tabIndex={0}
      >
        <table className="task-dashboard__table" aria-busy={loading}>
          <caption className="task-dashboard__sr-only">
            Tasks matching your selected view and filters
          </caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Status</th>
              <th scope="col">Assignee</th>
              <th scope="col">Due date</th>
              <th scope="col">
                <span className="task-dashboard__sr-only">Open document</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {results.docs.map((task) => {
              const overdue =
                task.status !== 'done' && !!task.dueDate && task.dueDate.slice(0, 10) < today
              return (
                <tr key={task.id}>
                  <td>
                    <button
                      type="button"
                      className="task-dashboard__task-name"
                      onClick={() => onSelect(task)}
                    >
                      {task.title}
                    </button>
                    <span className="task-dashboard__document">
                      {task.crmType ? `VortiCause · ${crmTaskSourceLabel(task.crmType)} · ${task.crmSite}` : task.documentDeleted
                        ? 'Document unavailable'
                        : task.documentTitle || task.documentID}{' '}
                      {!task.crmType && <>· {documentNames[task.documentType] ?? 'Document'}</>}
                      {task.parent ? ' · Subtask' : ''}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`task-dashboard__status task-dashboard__status--${task.status}`}
                    >
                      {statuses[task.status as keyof typeof statuses] ?? task.status}
                    </span>
                  </td>
                  <td>
                    <span className={task.assignee ? '' : 'task-dashboard__muted'}>
                      {person(task.assignee)}
                    </span>
                  </td>
                  <td className={overdue ? 'task-dashboard__overdue' : undefined}>
                    {task.dueDate ? (
                      <>
                        <time dateTime={task.dueDate.slice(0, 10)}>{dateLabel(task.dueDate)}</time>
                        {overdue && <span className="task-dashboard__due-label">Overdue</span>}
                      </>
                    ) : (
                      <span className="task-dashboard__muted" aria-label="No due date">
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    {task.crmType && task.crmSite && task.crmID ? (
                      <a className="task-dashboard__document-link" href={crmTaskSourceHref(admin, task.crmSite, task.crmType, task.crmID)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${crmTaskSourceLabel(task.crmType)} in VortiCause`} title="Open in VortiCause"><TaskIcon name="external" /></a>
                    ) : task.documentDeleted ||
                    task.documentRestricted ||
                    !task.documentType ||
                    !task.documentID ? (
                      <button
                        type="button"
                        className="task-dashboard__document-link"
                        disabled
                        aria-label="Document unavailable"
                        title="Document unavailable"
                      >
                        <TaskIcon name="external" />
                      </button>
                    ) : (
                      <a
                        className="task-dashboard__document-link"
                        href={taskDocumentLink(task, admin)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${task.documentTitle || task.title} in new tab`}
                        title="Open document in new tab"
                      >
                        <TaskIcon name="external" />
                      </a>
                    )}
                  </td>
                </tr>
              )
            })}
            {!results.docs.length && (
              <tr>
                <td colSpan={5} className="task-dashboard__empty">
                  {loading
                    ? 'Finding your tasks…'
                    : error
                      ? 'Tasks could not be loaded.'
                      : 'No tasks match these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="task-dashboard__footer">
        <label>
          Rows per page
          <select
            aria-label="Rows per page"
            value={filters.limit}
            onChange={(event) => update({ limit: Number(event.target.value) })}
          >
            {Array.from(new Set([10, 25, 50, 100, filters.limit]))
              .sort((a, b) => a - b)
              .map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
          </select>
        </label>
        <nav aria-label="Task pages">
          <span>
            {results.totalDocs
              ? `${(filters.page - 1) * filters.limit + 1}–${Math.min(filters.page * filters.limit, results.totalDocs)} of ${results.totalDocs}`
              : '0 tasks'}
          </span>
          <button
            type="button"
            disabled={loading || filters.page <= 1}
            onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
          >
            Previous
          </button>
          <span>
            Page {filters.page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={loading || filters.page >= totalPages}
            onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
          >
            Next
          </button>
        </nav>
      </div>
    </section>
  )
}
