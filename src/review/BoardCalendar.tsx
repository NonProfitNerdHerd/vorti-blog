'use client'
import type { ReactNode } from 'react'
import { calendarTaskSpan, type CalendarDisplay } from './task-schedule'
import { siteCalendarDay } from './workspace-dates'
import { localTaskDay, nextTaskDay } from './dashboard-model'
import { statuses, type Task } from './client'
import { List } from './WorkspaceIcon'
export function calendarAnchor(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return localTaskDay()
  const parsed = new Date(value + 'T12:00:00')
  return Number.isFinite(parsed.getTime()) && localTaskDay(parsed) === value
    ? value
    : localTaskDay()
}
export function calendarModeValue(value?: string | null) {
  return ['month', 'week', 'agenda'].includes(value ?? '') ? value! : 'month'
}
export function calendarPeriod(anchor: string, mode: string) {
  const chosen = new Date(anchor + 'T12:00:00'),
    first = new Date(chosen.getFullYear(), chosen.getMonth(), 1)
  if (mode === 'week') {
    const start = localTaskDay(
      new Date(
        chosen.getFullYear(),
        chosen.getMonth(),
        chosen.getDate() - ((chosen.getDay() + 6) % 7),
      ),
    )
    return { start, end: nextTaskDay(start, 7), days: 7 }
  }
  return {
    start: localTaskDay(first),
    end: localTaskDay(new Date(chosen.getFullYear(), chosen.getMonth() + 1, 1)),
    days: 42,
  }
}
export function shiftCalendar(anchor: string, mode: string, direction: number) {
  if (mode === 'week') return nextTaskDay(anchor, direction * 7)
  const chosen = new Date(anchor + 'T12:00:00')
  return localTaskDay(new Date(chosen.getFullYear(), chosen.getMonth() + direction, 1))
}
export function BoardCalendar({
  tasks,
  anchor,
  mode,
  onAnchor,
  onMode,
  onSelect,
  patch,
  canEdit,
  priorityColors,
  display = 'due',
  onDisplay,
  toolbar,
  timezone = 'UTC',
}: {
  display?: CalendarDisplay
  onDisplay?: (value: CalendarDisplay) => void
  toolbar?: ReactNode
  timezone?: string
  tasks: Task[]
  anchor: string
  mode: string
  onAnchor: (date: string) => void
  onMode: (mode: string) => void
  onSelect: (task: Task) => void
  patch: (task: Task, data: object) => Promise<void>
  canEdit: boolean
  priorityColors?: Record<string, string>
}) {
  const period = calendarPeriod(anchor, mode),
    chosen = new Date(period.start + 'T12:00:00'),
    gridStart =
      mode === 'week'
        ? period.start
        : localTaskDay(
            new Date(chosen.getFullYear(), chosen.getMonth(), 1 - ((chosen.getDay() + 6) % 7)),
          ),
    days = Array.from({ length: period.days }, (_, i) => nextTaskDay(gridStart, i)),
    spans = tasks
      .map((task) => ({ task, span: calendarTaskSpan(task, display, timezone) }))
      .filter((item) => item.span !== null),
    dated = spans
      .filter(
        (item) =>
          item.span?.start &&
          item.span?.end &&
          item.span.start < period.end &&
          item.span.end >= period.start,
      )
      .map((item) => item.task)
      .sort(
        (a, b) =>
          (calendarTaskSpan(a, display, timezone)?.start ?? '').localeCompare(
            calendarTaskSpan(b, display, timezone)?.start ?? '',
          ) || a.title.localeCompare(b.title),
      ),
    undated = spans.filter((item) => !item.span?.start).map((item) => item.task)
  const taskButton = (task: Task) => (
    <button className="workspace-calendar-task" type="button" onClick={() => onSelect(task)}>
      {task.parent ? '↳ ' : ''}
      {task.title}
    </button>
  )
  const table = (items: Task[], dates = false) => (
    <div className="workspace-calendar-table">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Assignee</th>
            <th>
              {display === 'created'
                ? 'Created date'
                : display === 'open'
                  ? 'Scheduled dates'
                  : 'Due date'}
            </th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {items.map((task) => (
            <tr key={task.id}>
              <td>
                {taskButton(task)}
                {task.parent && (
                  <small>
                    Subtask of{' '}
                    {tasks.find((parent) => parent.id === task.parent)?.title ??
                      `Task #${task.parent}`}
                  </small>
                )}
              </td>
              <td>
                <span className={`workspace-status status-${task.status}`}>
                  {statuses[task.status as keyof typeof statuses]}
                </span>
              </td>
              <td>{task.assigneeLabel || 'Unassigned'}</td>
              <td>
                {display === 'due' && canEdit && task.canEdit ? (
                  <input
                    type="date"
                    aria-label={`Schedule ${task.title}`}
                    defaultValue={task.dueDate?.slice(0, 10) || ''}
                    onChange={async (event) => {
                      const input = event.currentTarget,
                        previous = task.dueDate?.slice(0, 10) || ''
                      try {
                        await patch(task, {
                          dueDate: input.value ? input.value + 'T12:00:00.000Z' : null,
                        })
                      } catch {
                        input.value = previous
                      }
                    }}
                  />
                ) : dates ? (
                  display === 'open' ? (
                    `${calendarTaskSpan(task, display, timezone)?.start ?? '—'} — ${calendarTaskSpan(task, display, timezone)?.end ?? '—'}`
                  ) : (
                    calendarTaskSpan(task, display, timezone)?.start
                  )
                ) : (
                  'No date'
                )}
              </td>
              <td>
                <span
                  className="workspace-calendar-priority"
                  style={{
                    borderLeft: `4px solid ${priorityColors?.[task.priority] ?? ({ low: '#15803d', normal: '#2563eb', high: '#c2410c', urgent: '#dc2626' } as Record<string, string>)[task.priority]}`,
                  }}
                >
                  {task.priority}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <section className="workspace-calendar-view">
      <header className="workspace-calendar-controls">
        <div className="workspace-calendar-add">{toolbar}</div>
        <div>
          <button
            type="button"
            aria-label="Previous calendar period"
            onClick={() => onAnchor(shiftCalendar(anchor, mode, -1))}
          >
            ‹
          </button>
          <button type="button" onClick={() => onAnchor(siteCalendarDay(new Date(), timezone))}>
            Today
          </button>
          <button
            type="button"
            aria-label="Next calendar period"
            onClick={() => onAnchor(shiftCalendar(anchor, mode, 1))}
          >
            ›
          </button>
          <h3>
            {mode === 'week'
              ? `${period.start} – ${nextTaskDay(period.end, -1)}`
              : chosen.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h3>
        </div>
        <div role="group" aria-label="Calendar views">
          {['month', 'week', 'agenda'].map((value) => (
            <button
              type="button"
              key={value}
              aria-label={`${value[0].toUpperCase() + value.slice(1)} view`}
              title={value}
              aria-pressed={mode === value}
              onClick={() => onMode(value)}
            >
              {value === 'agenda' ? (
                <List size={18} />
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="17" rx="2" />
                  <path
                    d={
                      value === 'month'
                        ? 'M3 9h18 M8 9v12 M15 9v12 M3 15h18'
                        : 'M3 9h18 M9 9v12 M15 9v12'
                    }
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      </header>
      <div className="workspace-calendar-options">
        <label>
          Show tasks by
          <select
            value={display}
            onChange={(event) => onDisplay?.(event.target.value as CalendarDisplay)}
          >
            <option value="due">Due date</option>
            <option value="open">All Open Tasks</option>
            <option value="created">Created date</option>
          </select>
        </label>
        <label className="workspace-calendar-jump">
          Go to date{' '}
          <input
            type="date"
            aria-label="Calendar date"
            value={anchor}
            onChange={(event) => onAnchor(event.target.value || localTaskDay())}
          />
        </label>
      </div>
      {mode === 'agenda' ? (
        <>
          {!dated.length && <p>No dated tasks in this month.</p>}
          {table(dated, true)}
        </>
      ) : (
        <div className="workspace-calendar-scroll">
          <div className={`workspace-calendar workspace-calendar-${mode}`}>
            {days.map((date) => (
              <section
                key={date}
                aria-label={date}
                className={date < period.start || date >= period.end ? 'workspace-other-month' : ''}
              >
                <h4>
                  {new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                  })}
                </h4>
                {tasks
                  .filter((task) => {
                    const span = calendarTaskSpan(task, display, timezone)
                    return span?.start && span.end && span.start <= date && span.end >= date
                  })
                  .map((task) => (
                    <div
                      key={task.id}
                      className="workspace-calendar-bubble"
                      title={`${task.title}: ${calendarTaskSpan(task, display, timezone)?.start} — ${calendarTaskSpan(task, display, timezone)?.end}`}
                    >
                      {taskButton(task)}
                    </div>
                  ))}
              </section>
            ))}
          </div>
        </div>
      )}
      <h3>Undated tasks</h3>
      {undated.length ? table(undated) : <p>No undated tasks.</p>}
    </section>
  )
}
