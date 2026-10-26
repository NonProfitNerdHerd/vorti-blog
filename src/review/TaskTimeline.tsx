'use client'
import { useRef, useState, type ReactNode } from 'react'
import type { Task } from './client'
import { localTaskDay, nextTaskDay } from './dashboard-model'
import { moveTaskDates, timelineRanges } from './task-schedule'
type ScheduledTask = Task & {
  dependencies: {
    id: number
    task?: number
    title?: string
    dueDate?: string
    status?: string
    unavailable?: boolean
  }[]
}
const difference = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000)
export function TaskTimeline({
  tasks,
  onSelect,
  patch,
  canEdit,
  baseline,
  toolbar,
  groupLabel,
}: {
  tasks: ScheduledTask[]
  onSelect: (task: Task) => void
  patch: (task: Task, data: object) => Promise<void>
  canEdit: boolean
  baseline: any
  toolbar: ReactNode
  groupLabel: (task: ScheduledTask) => string
}) {
  const [start, setStart] = useState(localTaskDay()),
    [length, setLength] = useState(28),
    [error, setError] = useState('')
  const [drag, setDrag] = useState<{
    id: number
    edge: 'move' | 'start' | 'end'
    x: number
    days: number
  }>()
  const gesture = useRef<typeof drag>(undefined),
    suppressClick = useRef(false),
    [saving, setSaving] = useState<number>()
  const end = nextTaskDay(start, length - 1),
    offset = (day: string) => Math.max(0, Math.min(length - 1, difference(day, start)))
  const update = async (task: ScheduledTask, days: number, edge: 'move' | 'start' | 'end') => {
    const value = moveTaskDates(task, days, edge)
    if (!value || !days) return
    setSaving(task.id)
    setError('')
    try {
      await patch(task, value)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setSaving(undefined)
    }
  }
  const control = (task: ScheduledTask, edge: 'move' | 'start' | 'end') => ({
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (!canEdit || !task.canEdit || task.id < 0 || saving || event.button !== 0) return
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      gesture.current = { id: task.id, edge, x: event.clientX, days: 0 }
      setDrag(gesture.current)
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (!gesture.current || gesture.current.id !== task.id || gesture.current.edge !== edge)
        return
      const days = Math.round((event.clientX - gesture.current.x) / 24)
      gesture.current = { ...gesture.current, days }
      setDrag(gesture.current)
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const current = gesture.current
      if (!current || current.id !== task.id || current.edge !== edge) return
      event.stopPropagation()
      gesture.current = undefined
      setDrag(undefined)
      suppressClick.current = current.edge === 'move' && !!current.days
      if (current.days) void update(task, current.days, edge)
    },
    onPointerCancel: () => {
      gesture.current = undefined
      setDrag(undefined)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        gesture.current = undefined
        setDrag(undefined)
        return
      }
      if (
        !canEdit ||
        !task.canEdit ||
        task.id < 0 ||
        saving ||
        !['ArrowLeft', 'ArrowRight'].includes(event.key)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      void update(task, event.key === 'ArrowLeft' ? -1 : 1, edge)
    },
  })
  const visibleBar = (task: ScheduledTask) => {
    const dates = drag?.id === task.id ? moveTaskDates(task, drag.days, drag.edge) : null
    const from = (dates?.startDate || task.startDate || task.dueDate)?.slice(0, 10),
      to = (dates?.dueDate || task.dueDate || task.startDate)?.slice(0, 10)
    return from && to && from <= end && to >= start
      ? { from, to, left: offset(from) * 24, width: (offset(to) - offset(from) + 1) * 24 }
      : undefined
  }
  return (
    <section className="workspace-schedule">
      <div className="task-workspace-toolbar">
        {toolbar}
        <label>
          Range start
          <input
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value || localTaskDay())}
          />
        </label>
        <label>
          Visible days
          <select value={length} onChange={(event) => setLength(Number(event.target.value))}>
            {timelineRanges.map((days) => (
              <option key={days} value={days}>
                {days}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="workspace-schedule-help">
        Drag a bar to move it; drag its ends to resize. Focus a bar or end and use arrow keys to
        adjust by one day. Dependent tasks keep their dates.
      </p>
      <div className="workspace-timeline-scroll">
        <div className="workspace-schedule-grid" style={{ width: 280 + length * 24 }}>
          <div className="workspace-schedule-scale">
            <strong>Task</strong>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${length},24px)` }}>
              {Array.from({ length }, (_, index) => (
                <small key={index}>{nextTaskDay(start, index).slice(5)}</small>
              ))}
            </div>
          </div>
          <div className="workspace-schedule-rows">
            <svg
              className="workspace-dependency-lines"
              width={length * 24}
              height={tasks.length * 64}
              aria-label="Task dependency connectors"
            >
              {tasks.flatMap((task, index) =>
                task.dependencies.map((dependency) => {
                  const predecessor = tasks.findIndex((item) => item.id === dependency.task),
                    a = predecessor >= 0 ? visibleBar(tasks[predecessor]) : undefined,
                    b = visibleBar(task)
                  if (!a || !b) return null
                  const x1 = a.left + a.width,
                    x2 = b.left,
                    y1 = predecessor * 64 + 32,
                    y2 = index * 64 + 32,
                    bend = Math.max(x1 + 10, x2 - 10)
                  return (
                    <g key={`${task.id}-${dependency.id}`}>
                      <title>{`${dependency.title ?? 'Predecessor'} → ${task.title}`}</title>
                      <path d={`M${x1} ${y1}H${bend}V${y2}H${x2}`} />
                      <path d={`M${x2 - 5} ${y2 - 4}L${x2} ${y2}L${x2 - 5} ${y2 + 4}`} />
                    </g>
                  )
                }),
              )}
            </svg>
            {tasks.map((task) => {
              const bar = visibleBar(task),
                conflict = task.dependencies.some(
                  (dep) =>
                    dep.dueDate &&
                    bar &&
                    dep.dueDate.slice(0, 10) >= bar.from &&
                    dep.status !== 'done',
                ),
                before = baseline?.snapshot?.find((item: any) => item.id === task.id)
              return (
                <div key={task.id} className="workspace-schedule-row">
                  <div className="workspace-schedule-name">
                    <button
                      type="button"
                      className="workspace-timeline-title"
                      disabled={task.id < 0}
                      onClick={() => onSelect(task)}
                    >
                      {task.parent ? '↳ ' : ''}
                      {task.title}
                    </button>
                    <small>
                      {groupLabel(task)}
                      {conflict ? ' · Dependency date conflict' : ''}
                    </small>
                    {before && (
                      <small>
                        Baseline: {before.startDate?.slice(0, 10) || '—'} —{' '}
                        {before.dueDate?.slice(0, 10) || '—'}
                      </small>
                    )}
                  </div>
                  <div className="workspace-schedule-track">
                    {bar ? (
                      <div
                        className={`workspace-schedule-bar${conflict ? ' has-conflict' : ''}${task.milestone ? ' is-milestone' : ''}`}
                        style={{ left: bar.left, width: bar.width }}
                      >
                        <button
                          type="button"
                          className="workspace-bar-edge"
                          aria-label={`Resize start of ${task.title}`}
                          disabled={!canEdit || !task.canEdit || task.id < 0 || !!saving}
                          {...control(task, 'start')}
                        />
                        <button
                          type="button"
                          className="workspace-bar-main"
                          aria-label={`Open or move ${task.title}`}
                          title={`${task.title}: ${bar.from} — ${bar.to}`}
                          {...control(task, 'move')}
                          onClick={() => {
                            if (suppressClick.current) {
                              suppressClick.current = false
                              return
                            }
                            onSelect(task)
                          }}
                        >
                          {task.milestone ? '◆' : task.title}
                        </button>
                        <button
                          type="button"
                          className="workspace-bar-edge"
                          aria-label={`Resize end of ${task.title}`}
                          disabled={!canEdit || !task.canEdit || task.id < 0 || !!saving}
                          {...control(task, 'end')}
                        />
                      </div>
                    ) : (
                      <small>
                        {task.startDate || task.dueDate ? 'Outside selected range' : 'Undated'}
                      </small>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
