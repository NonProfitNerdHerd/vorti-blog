'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Board URL state and authorized remote records are synchronized here. */
import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Share2, Settings2, RefreshCw, SlidersHorizontal } from './WorkspaceIcon'
import { BoardIcon } from './BoardIcon'
import { InlineTaskEntry } from './InlineTaskEntry'
import { WorkspaceFilterPanel } from './WorkspaceFilterPanel'
import { useAuth } from '@payloadcms/ui'
import { query, reviewAll, reviewAPI, statuses, type Task } from './client'
import { BoardSettings, type Board } from './WorkspaceBoards'
import {
  WorkspaceFiles,
  WorkspaceFieldValue,
  type FieldDefinition,
  type FieldResult,
} from './WorkspaceTaskDetails'
import {
  FieldManager,
  BoardPage,
  BoardMessages,
  EmbedView,
  ViewManager,
  ProjectBoardSharing,
} from './WorkspaceBoardTools'
import { localTaskDay, nextTaskDay } from './dashboard-model'
import {
  siteCalendarDay,
  siteWeek,
  secondsInWindow,
  localTimeInput,
  parseLocalTime,
} from './workspace-dates'
import { workspaceDialog } from './WorkspaceDialogs'
import './projects.css'

type WorkTask = Task & {
  fields: FieldResult[]
  time: { seconds: number; entries: any[]; manager: boolean }
  dependencies: {
    id: number
    task?: number
    title?: string
    dueDate?: string
    status?: string
    unavailable?: boolean
  }[]
}
type View = {
  id: number
  name: string
  kind: string
  position: number
  defaultView?: boolean
  configuration?: any
  updatedAt: string
}
type Section = { id: number; name: string; position: number; updatedAt: string }
const day = (value?: string) => value?.slice(0, 10) ?? ''
const today = () => localTaskDay(new Date())
export function ExpandedBoard({
  api,
  admin,
  id,
  onSelect,
  onCreate,
  refreshKey,
}: {
  api: string
  admin: string
  id: string
  onSelect: (task: Task) => void
  onCreate: (parent?: Task, section?: number) => void
  refreshKey: number
}) {
  const routeParams = useSearchParams(),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pageDirty = useRef(false),
    preferenceWrites = useRef<Promise<unknown>>(Promise.resolve()),
    loadSequence = useRef(0)
  const [board, setBoard] = useState<Board & { project?: number; inheritProject?: boolean }>(),
    [project, setProject] = useState<any>(),
    [tasks, setTasks] = useState<WorkTask[]>([]),
    [summary, setSummary] = useState<any>(),
    [sections, setSections] = useState<Section[]>([]),
    [views, setViews] = useState<View[]>([]),
    [fields, setFields] = useState<FieldDefinition[]>([]),
    [placements, setPlacements] = useState<any[]>([]),
    [preference, setPreference] = useState<any>(),
    [people, setPeople] = useState<any[]>([])
  const [viewID, setViewID] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [assignee, setAssignee] = useState(''),
    [group, setGroup] = useState('section'),
    [sort, setSort] = useState('position'),
    [expanded, setExpanded] = useState<number[]>([]),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [showChildren, setShowChildren] = useState(true),
    [anchor, setAnchor] = useState(today()),
    [calendarMode, setCalendarMode] = useState('month'),
    [baseline, setBaseline] = useState<any>(),
    [baselines, setBaselines] = useState<any[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createdNotice, setCreatedNotice] = useState<Task | null>(null)
  const [settings, setSettings] = useState(false),
    [fieldManager, setFieldManager] = useState(false),
    [viewManager, setViewManager] = useState(false),
    [sharing, setSharing] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [sectionName, setSectionName] = useState(''),
    [columnSettings, setColumnSettings] = useState<Record<string, any>>({}),
    [showColumns, setShowColumns] = useState(false)
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const [record, report, s, v, p, prefs, attached, persons, b] = await Promise.all([
        reviewAPI<any>(api, `task-boards/${id}?depth=0`),
        reviewAPI<any>(api, `task-workspace/boards/${id}/report?today=${today()}`),
        reviewAll<Section>(
          api,
          'task-sections',
          { and: [{ board: { equals: id } }, { archived: { not_equals: true } }] },
          'position',
        ),
        reviewAll<View>(api, 'task-views', { board: { equals: id } }, 'position'),
        reviewAll<any>(
          api,
          'task-placements',
          { and: [{ board: { equals: id } }, { active: { equals: true } }] },
          'position',
        ),
        reviewAll<any>(api, 'task-board-preferences', { board: { equals: id } }),
        reviewAll<any>(api, 'task-board-fields', { board: { equals: id } }, 'position'),
        reviewAPI<any>(api, `review-tasks/assignees?board=${id}`),
        reviewAll<any>(api, 'task-baselines', { board: { equals: id } }),
      ])
      if (sequence !== loadSequence.current) return
      setBoard(record)
      setTasks(report.tasks)
      setSummary({ ...report, complete: report.totalPages <= 1 })
      setSections(s)
      setViews(v)
      setPlacements(p)
      setPreference(prefs[0])
      setPeople(persons.docs ?? [])
      setBaselines(b)
      const definitions = []
      for (const item of attached) {
        const definition = await reviewAPI<FieldDefinition & { archived?: boolean }>(
          api,
          `task-field-definitions/${item.field}?depth=0`,
        )
        if (!definition.archived) definitions.push(definition)
      }
      if (sequence !== loadSequence.current) return
      setFields(definitions)
      if (record.project) {
        try {
          const nextProject = await reviewAPI(api, `task-projects/${record.project}?depth=0`)
          if (sequence !== loadSequence.current) return
          setProject(nextProject)
        } catch {
          setProject(undefined)
        }
      }
      const params = new URLSearchParams(location.search),
        requested =
          params.get('boardView') ?? (params.has('view') ? undefined : prefs[0]?.viewInstance),
        selected =
          v.find((view) => String(view.id) === String(requested)) ??
          v.find((view) => view.kind === params.get('view')) ??
          v.find((view) => view.kind === prefs[0]?.view) ??
          v.find((view) => view.defaultView) ??
          v[0]
      setViewID((previous) =>
        v.some((view) => String(view.id) === previous) ? previous : String(selected?.id ?? ''),
      )
      setError('')
      const all = [...report.tasks],
        allCounts = { ...report.counts },
        allAssignees = { ...report.assignees }
      let overdue = report.overdue,
        seconds = report.seconds,
        latestTotal = report.totalDocs
      for (let page = 2; page <= report.totalPages; page++) {
        const next = await reviewAPI<any>(
          api,
          `task-workspace/boards/${id}/report?today=${today()}&page=${page}`,
        )
        if (sequence !== loadSequence.current) return
        all.push(...next.tasks)
        latestTotal = next.totalDocs
        for (const [status, count] of Object.entries(next.counts))
          allCounts[status] = (allCounts[status] ?? 0) + Number(count)
        for (const [assignee, stats] of Object.entries(next.assignees) as [
          string,
          { tasks: number; seconds: number },
        ][]) {
          allAssignees[assignee] ??= { tasks: 0, seconds: 0 }
          allAssignees[assignee] = {
            tasks: allAssignees[assignee].tasks + stats.tasks,
            seconds: allAssignees[assignee].seconds + stats.seconds,
          }
        }
        overdue += next.overdue
        seconds += next.seconds
        setTasks([...new Map(all.map((task) => [task.id, task])).values()])
        setSummary({
          ...report,
          counts: { ...allCounts },
          assignees: { ...allAssignees },
          overdue,
          seconds,
          complete: false,
        })
      }
      const unique = [...new Map(all.map((task) => [task.id, task])).values()]
      const finalCounts: Record<string, number> = {},
        finalAssignees: Record<string, { tasks: number; seconds: number }> = {}
      let finalSeconds = 0,
        finalOverdue = 0
      for (const task of unique) {
        finalCounts[task.status] = (finalCounts[task.status] ?? 0) + 1
        const key = String(task.assignee ?? 'unassigned')
        finalAssignees[key] ??= { tasks: 0, seconds: 0 }
        finalAssignees[key].tasks++
        finalAssignees[key].seconds += task.time.seconds
        finalSeconds += task.time.seconds
        if (task.status !== 'done' && task.dueDate && day(task.dueDate) < today()) finalOverdue++
      }
      setTasks(unique)
      setSummary({
        ...report,
        counts: finalCounts,
        assignees: finalAssignees,
        overdue: finalOverdue,
        seconds: finalSeconds,
        complete: unique.length === latestTotal,
      })
      if (unique.length !== latestTotal)
        setError('This board changed while loading. Refresh to calculate complete totals.')
    } catch (e) {
      if (sequence !== loadSequence.current) return
      setError((e as Error).message)
      if ([403, 404].includes((e as { status?: number }).status ?? 0)) {
        setBoard(undefined)
        setTasks([])
        setViews([])
        setProject(undefined)
        setFields([])
        setSummary(undefined)
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [
    api,
    id,
    setError,
    setLoading,
    setBoard,
    setTasks,
    setSummary,
    setSections,
    setViews,
    setPlacements,
    setPreference,
    setPeople,
    setBaselines,
    setFields,
    setProject,
    setViewID,
  ])
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setSearch(params.get('boardSearch') ?? '')
    setStatus(params.get('boardStatus') ?? '')
    setAssignee(params.get('boardAssignee') ?? '')
    setGroup(params.get('group') ?? 'section')
    setSort(params.get('boardSort') ?? 'position')
    setShowChildren(params.get('subtasks') !== 'false')
    setAnchor(params.get('calendarDate') ?? today())
    setCalendarMode(params.get('calendarRange') ?? 'month')
    void load()
  }, [load, refreshKey])
  useEffect(() => {
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  const view = views.find((view) => String(view.id) === viewID),
    kind = view?.kind ?? 'list',
    canEdit =
      ['owner', 'editor'].includes(board?.workspaceRole ?? '') &&
      !board?.archived &&
      !project?.archived,
    isOwner = board?.workspaceRole === 'owner'
  useEffect(() => {
    const saved = preference?.viewSettings?.[viewID] ?? {}
    setColumnSettings(saved.columns ?? {})
  }, [preference, viewID])
  useEffect(() => {
    const params = new URLSearchParams(location.search),
      saved = preference?.viewSettings?.[viewID] ?? {}
    setSearch(params.get('boardSearch') ?? saved.boardSearch ?? '')
    setStatus(params.get('boardStatus') ?? saved.boardStatus ?? '')
    setAssignee(params.get('boardAssignee') ?? saved.boardAssignee ?? '')
    setGroup(params.get('group') ?? saved.group ?? 'section')
    setSort(params.get('boardSort') ?? saved.boardSort ?? 'position')
    setAnchor(params.get('calendarDate') || saved.calendarDate || today())
    setCalendarMode(params.get('calendarRange') ?? saved.calendarRange ?? 'month')
    setShowChildren((params.get('subtasks') ?? saved.subtasks) !== 'false')
  }, [viewID, preference?.id])
  const requestedView = routeParams.get('boardView'),
    requestedKind = routeParams.get('view')
  useEffect(() => {
    const selected = requestedView
      ? views.find((view) => String(view.id) === requestedView)
      : requestedKind
        ? views.find((view) => view.kind === requestedKind)
        : undefined
    if (selected) setViewID(String(selected.id))
  }, [requestedView, requestedKind, views])
  useEffect(() => {
    const changed = (event: Event) => {
      pageDirty.current = !!(event as CustomEvent).detail
    }
    window.addEventListener('vorti-board-page-dirty', changed)
    return () => {
      loadSequence.current++
      window.removeEventListener('vorti-board-page-dirty', changed)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])
  const url = (key: string, value: string) => {
    const next = new URL(location.href)
    if (value) next.searchParams.set(key, value)
    else next.searchParams.delete(key)
    history.replaceState(null, '', next)
    if (!['boardView', 'view'].includes(key)) {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const filters = {
        boardSearch: search,
        boardStatus: status,
        boardAssignee: assignee,
        group,
        boardSort: sort,
        calendarDate: anchor,
        calendarRange: calendarMode,
        subtasks: String(showChildren),
        columns: columnSettings,
        [key]: value,
      }
      saveTimer.current = setTimeout(() => {
        void savePreference({
          viewSettings: { ...preference?.viewSettings, [viewID]: filters },
        }).catch((error) => setError(error.message))
      }, 400)
    }
  }
  const savePreference = async (patch: Record<string, unknown>) => {
    const save = async () => {
      const current = (
        await reviewAll<any>(api, 'task-board-preferences', { board: { equals: id } })
      )[0]
      const data = {
        board: Number(id),
        ...patch,
        ...(patch.viewSettings
          ? { viewSettings: { ...current?.viewSettings, ...(patch.viewSettings as object) } }
          : {}),
      }
      let response: any
      try {
        response = await reviewAPI<any>(
          api,
          `task-board-preferences${current ? `/${current.id}` : ''}`,
          current ? 'PATCH' : 'POST',
          data,
        )
      } catch (error) {
        if (current) throw error
        const existing = (
          await reviewAll<any>(api, 'task-board-preferences', { board: { equals: id } })
        )[0]
        if (!existing) throw error
        response = await reviewAPI<any>(api, `task-board-preferences/${existing.id}`, 'PATCH', data)
      }
      if (String(response.doc.board) === id) setPreference(response.doc)
    }
    const next = preferenceWrites.current.catch(() => {}).then(save)
    preferenceWrites.current = next
    await next
  }
  const selectView = (selected: View) => {
    if (pageDirty.current && !confirm('Discard unsaved page changes?')) return
    pageDirty.current = false
    setViewID(String(selected.id))
    url('boardView', String(selected.id))
    url('view', selected.kind)
    void savePreference({ view: selected.kind, viewInstance: selected.id }).catch((e) =>
      setError(e.message),
    )
  }
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      window.dispatchEvent(new Event('vorti-tasks-changed'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const patch = (task: Task, data: object) =>
    run(() =>
      reviewAPI(api, `review-tasks/${task.id}`, 'PATCH', {
        ...data,
        expectedUpdatedAt: task.updatedAt,
      }),
    )
  const filtered = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (!search || task.title.toLowerCase().includes(search.toLowerCase())) &&
          (!status || task.status === status) &&
          (!assignee ||
            (assignee === 'unassigned' ? !task.assignee : String(task.assignee) === assignee)),
      ),
    [tasks, search, status, assignee],
  )
  const roots = tasks.filter(
      (task) =>
        !task.parent &&
        (filtered.includes(task) || filtered.some((child) => child.parent === task.id)),
    ),
    fieldGroup = fields.find((field) => `field:${field.id}` === group)
  const groups =
    group === 'status'
      ? Object.entries(statuses).map(([key, name]) => ({ key, name }))
      : group === 'assignee'
        ? [
            { key: '', name: 'Unassigned' },
            ...people.map((person) => ({ key: String(person.id), name: person.label })),
          ]
        : fieldGroup
          ? (fieldGroup.configuration?.options ?? [])
              .filter((option) => !option.retired)
              .map((option) => ({ key: option.id, name: option.label }))
              .concat([{ key: '', name: 'No value' }])
          : [
              { key: '', name: 'Unsectioned' },
              ...sections.map((section) => ({ key: String(section.id), name: section.name })),
            ]
  const groupFor = (task: WorkTask) =>
    group === 'status'
      ? task.status
      : group === 'assignee'
        ? String(task.assignee ?? '')
        : fieldGroup
          ? String(task.fields.find((field) => field.definition.id === fieldGroup.id)?.value ?? '')
          : String(
              placements.find((placement) => placement.task === (task.parent ?? task.id))
                ?.section ?? '',
            )
  const sorted = (items: WorkTask[]) =>
    [...items].sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'dueDate'
          ? (day(a.dueDate) || '9999').localeCompare(day(b.dueDate) || '9999')
          : sort === '-updatedAt'
            ? (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
            : (placements.find((p) => p.task === a.id)?.position ?? 0) -
              (placements.find((p) => p.task === b.id)?.position ?? 0),
    )
  const move = async (task: WorkTask, key: string) => {
    if (group === 'status') return patch(task, { status: key })
    if (group === 'assignee') return patch(task, { assignee: key ? Number(key) : null })
    if (fieldGroup)
      return run(() =>
        reviewAPI(api, `task-workspace/tasks/${task.id}`, 'POST', {
          action: 'field',
          field: fieldGroup.id,
          value: key || null,
          expectedUpdatedAt: task.updatedAt,
        }),
      )
    const placement = placements.find((placement) => placement.task === (task.parent ?? task.id))
    return run(() =>
      reviewAPI(api, `review-tasks/${task.parent ?? task.id}/workspace`, 'POST', {
        action: 'move',
        board: Number(id),
        section: key ? Number(key) : null,
        position: Date.now(),
        expectedUpdatedAt: placement?.updatedAt,
      }),
    )
  }
  const nativeColumns = [
    { key: 'status', name: 'Status' },
    { key: 'assignee', name: 'Assignee' },
    { key: 'dueDate', name: 'Due date' },
    { key: 'priority', name: 'Priority' },
    ...fields.map((field) => ({ key: `field:${field.id}`, name: field.name })),
  ]
  const columns = nativeColumns
    .filter((column) => columnSettings[column.key]?.visible !== false)
    .sort(
      (a, b) =>
        (columnSettings[a.key]?.order ?? nativeColumns.indexOf(a)) -
        (columnSettings[b.key]?.order ?? nativeColumns.indexOf(b)),
    )
  const renderCell = (task: WorkTask, key: string) => {
    if (key === 'status')
      return (
        <select
          aria-label={`Status for ${task.title}`}
          disabled={!canEdit || !task.canEdit || busy}
          value={task.status}
          onChange={(e) => void patch(task, { status: e.target.value })}
        >
          {Object.entries(statuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )
    if (key === 'priority')
      return (
        <select
          aria-label={`Priority for ${task.title}`}
          disabled={!canEdit || !task.canEdit || busy}
          value={task.priority}
          onChange={(e) => void patch(task, { priority: e.target.value })}
        >
          {['low', 'normal', 'high', 'urgent'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      )
    if (key === 'assignee')
      return (
        <select
          aria-label={`Assignee for ${task.title}`}
          disabled={!canEdit || !task.canEdit || busy}
          value={task.assignee ?? ''}
          onChange={(e) =>
            void patch(task, { assignee: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">Unassigned</option>
          {task.assignee && !people.some((person) => person.id === task.assignee) && (
            <option value={task.assignee}>{task.assigneeLabel ?? 'Assigned user'}</option>
          )}
          {people.map((person) => (
            <option value={person.id} key={person.id}>
              {person.label}
            </option>
          ))}
        </select>
      )
    if (key === 'dueDate')
      return (
        <input
          aria-label={`Due date for ${task.title}`}
          type="date"
          disabled={!canEdit || !task.canEdit || busy}
          value={day(task.dueDate)}
          onChange={(e) =>
            void patch(task, { dueDate: e.target.value ? `${e.target.value}T12:00:00.000Z` : null })
          }
        />
      )
    const result = task.fields.find((field) => `field:${field.definition.id}` === key)
    return result ? (
      <WorkspaceFieldValue
        api={api}
        result={result}
        disabled={!canEdit || !task.canEdit || busy}
        onSave={async (value) => {
          await reviewAPI(api, `task-workspace/tasks/${task.id}`, 'POST', {
            action: 'field',
            field: result.definition.id,
            value,
            expectedUpdatedAt: task.updatedAt,
          })
          await load()
        }}
      />
    ) : (
      <span>—</span>
    )
  }
  const resetFilters = () => {
    setSearch('')
    setStatus('')
    setAssignee('')
    setGroup('section')
    setSort('position')
    setShowChildren(true)
    const next = new URL(location.href)
    for (const [key, value] of Object.entries({
      boardSearch: '',
      boardStatus: '',
      boardAssignee: '',
      group: 'section',
      boardSort: 'position',
      subtasks: 'true',
    }))
      next.searchParams.set(key, value)
    history.replaceState(null, '', next)
    void savePreference({
      viewSettings: {
        ...preference?.viewSettings,
        [viewID]: {
          ...preference?.viewSettings?.[viewID],
          boardSearch: '',
          boardStatus: '',
          boardAssignee: '',
          group: 'section',
          boardSort: 'position',
          subtasks: 'true',
        },
      },
    }).catch((error) => setError(error.message))
  }
  const createInline = async (title: string, grouping: string, parent?: WorkTask) => {
    if (!canEdit || (parent && !parent.canEdit))
      throw new Error('This board is read-only or your permissions have changed.')
    const data: Record<string, unknown> = parent
      ? { title, parent: parent.id, status: 'open', assignee: null, priority: 'normal' }
      : {
          title,
          initialBoard: Number(id),
          initialSection: group === 'section' && grouping ? Number(grouping) : undefined,
          status: group === 'status' ? grouping : status || 'open',
          priority: 'normal',
          assignee:
            group === 'assignee'
              ? grouping
                ? Number(grouping)
                : null
              : assignee && assignee !== 'unassigned'
                ? Number(assignee)
                : null,
          ...(fieldGroup && grouping
            ? { initialSelect: { field: fieldGroup.id, value: grouping } }
            : {}),
        }
    const result = await reviewAPI<{ doc: Task }>(api, 'review-tasks', 'POST', data)
    setCreatedNotice(result.doc)
    await load()
    window.dispatchEvent(new Event('vorti-tasks-changed'))
  }
  const row = (task: WorkTask, child = false) => (
    <tr key={task.id} className={child ? 'workspace-subtask-row' : ''}>
      <td>
        <div className="workspace-task-name">
          {!child && (
            <button
              type="button"
              aria-label={`${expanded.includes(task.id) ? 'Collapse' : 'Expand'} subtasks for ${task.title}`}
              onClick={() =>
                setExpanded((values) =>
                  values.includes(task.id)
                    ? values.filter((value) => value !== task.id)
                    : [...values, task.id],
                )
              }
            >
              {expanded.includes(task.id) ? '▾' : '▸'}
            </button>
          )}
          <input
            type="checkbox"
            aria-label={`Complete ${task.title}`}
            checked={task.status === 'done'}
            disabled={!canEdit || !task.canEdit || busy}
            onChange={(e) => void patch(task, { status: e.target.checked ? 'done' : 'open' })}
          />
          <button className="workspace-task-title" type="button" onClick={() => onSelect(task)}>
            {task.title}
          </button>
          {!child && tasks.some((item) => item.parent === task.id) && (
            <small>
              {tasks.filter((item) => item.parent === task.id && item.status === 'done').length}/
              {tasks.filter((item) => item.parent === task.id).length}
            </small>
          )}
        </div>
      </td>
      {columns.map((column) => (
        <td key={column.key}>{renderCell(task, column.key)}</td>
      ))}
      <td>
        {!child && canEdit && kind !== 'list' && (
          <button
            type="button"
            aria-label={`Add subtask to ${task.title}`}
            onClick={() => onCreate(task)}
          >
            ＋
          </button>
        )}
      </td>
    </tr>
  )
  if (!board && loading) return <p role="status">Loading board…</p>
  return (
    <section className="workspace-board">
      <header className="workspace-board-heading">
        <div>
          <div className="workspace-board-title">
            <BoardIcon api={api} board={Number(id)} name={board?.name ?? 'Board'} />
            <h2>{board?.name ?? 'Board'}</h2>
            <button
              type="button"
              aria-label="Toggle favorite"
              onClick={() =>
                void savePreference({ favorite: !preference?.favorite }).catch((e) =>
                  setError(e.message),
                )
              }
            >
              {preference?.favorite ? '★' : '☆'}
            </button>
          </div>
        </div>
        <div className="task-workspace-toolbar">
          <button
            data-board-filter-trigger
            type="button"
            className="workspace-icon-control"
            aria-label="Filter board tasks"
            title="Filters and view options"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal size={19} aria-hidden="true" />
            {(search ||
              status ||
              assignee ||
              group !== 'section' ||
              sort !== 'position' ||
              !showChildren) && (
              <span className="workspace-filter-dot" aria-label="Filters active" />
            )}
          </button>
          {isOwner && (
            <>
              <button
                className="workspace-icon-control"
                type="button"
                aria-label="Share board"
                title="Share"
                onClick={() => setSharing(true)}
              >
                <Share2 size={19} aria-hidden="true" />
              </button>
              <button
                className="workspace-icon-control"
                type="button"
                aria-label="Board settings"
                title="Board settings"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={19} aria-hidden="true" />
              </button>
            </>
          )}
          <button
            className="workspace-icon-control"
            type="button"
            aria-label="Refresh board"
            title="Refresh"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={19} aria-hidden="true" />
          </button>
        </div>
      </header>
      <nav className="workspace-view-tabs" aria-label="Board views">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-current={String(view.id) === viewID ? 'page' : undefined}
            onClick={() => selectView(view)}
          >
            {view.name}
          </button>
        ))}
        {isOwner && (
          <button
            type="button"
            aria-label="Add or customize board views"
            onClick={() => setViewManager(true)}
          >
            ＋
          </button>
        )}
      </nav>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Reload
          </button>
        </p>
      )}
      {loading && (
        <p className="workspace-loading" role="status">
          Updating board…
        </p>
      )}
      {(board?.archived || project?.archived) && (
        <p role="status">This board is read-only while it or its project is archived.</p>
      )}
      {kind !== 'list' && ['board', 'calendar', 'timeline', 'gantt'].includes(kind) && canEdit && (
        <button
          className="task-primary"
          type="button"
          aria-label="Add task"
          onClick={() => onCreate()}
        >
          ＋ Add task
        </button>
      )}
      {createdNotice && (
        <p role="status">
          Task created.{' '}
          <button type="button" onClick={() => onSelect(createdNotice)}>
            Open task
          </button>
          <button
            type="button"
            aria-label="Dismiss task confirmation"
            onClick={() => setCreatedNotice(null)}
          >
            ×
          </button>
        </p>
      )}
      {filtersOpen && (
        <WorkspaceFilterPanel close={() => setFiltersOpen(false)}>
          <div className="workspace-board-toolbar">
            {' '}
            <input
              aria-label="Search board tasks"
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                url('boardSearch', e.target.value)
              }}
            />
            <select
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                url('boardStatus', e.target.value)
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(statuses).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter assignee"
              value={assignee}
              onChange={(e) => {
                setAssignee(e.target.value)
                url('boardAssignee', e.target.value)
              }}
            >
              <option value="">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Group tasks"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value)
                url('group', e.target.value)
              }}
            >
              <option value="section">Sections</option>
              <option value="status">Status</option>
              <option value="assignee">Assignee</option>
              {fields
                .filter((field) => field.kind === 'single-select')
                .map((field) => (
                  <option key={field.id} value={`field:${field.id}`}>
                    {field.name}
                  </option>
                ))}
            </select>
            <select
              aria-label="Sort tasks"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value)
                url('boardSort', e.target.value)
              }}
            >
              {[
                ['position', 'Board order'],
                ['title', 'Task name'],
                ['dueDate', 'Due date'],
                ['-updatedAt', 'Last updated'],
              ].map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            {kind !== 'board' && (
              <label className="workspace-subtask-toggle">
                <input
                  type="checkbox"
                  checked={showChildren}
                  onChange={(event) => {
                    setShowChildren(event.target.checked)
                    url('subtasks', String(event.target.checked))
                  }}
                />
                Include subtasks
              </label>
            )}
            <button type="button" onClick={() => setShowColumns((value) => !value)}>
              Columns
            </button>
          </div>
          <button type="button" onClick={resetFilters}>
            Reset filters and view
          </button>
          {showColumns && (
            <fieldset className="workspace-column-settings">
              <legend>Your columns</legend>
              {nativeColumns.map((column, index) => (
                <label key={column.key}>
                  <input
                    type="checkbox"
                    checked={columnSettings[column.key]?.visible !== false}
                    onChange={(e) =>
                      setColumnSettings((values) => ({
                        ...values,
                        [column.key]: { ...values[column.key], visible: e.target.checked },
                      }))
                    }
                  />
                  {column.name}
                  <input
                    aria-label={`${column.name} width`}
                    type="number"
                    min={100}
                    max={500}
                    value={columnSettings[column.key]?.width ?? 160}
                    onChange={(e) =>
                      setColumnSettings((values) => ({
                        ...values,
                        [column.key]: {
                          ...values[column.key],
                          width: Math.max(100, Math.min(500, Number(e.target.value))),
                        },
                      }))
                    }
                  />
                  <input
                    aria-label={`${column.name} order`}
                    type="number"
                    min={0}
                    max={nativeColumns.length}
                    value={columnSettings[column.key]?.order ?? index}
                    onChange={(e) =>
                      setColumnSettings((values) => ({
                        ...values,
                        [column.key]: { ...values[column.key], order: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                onClick={() =>
                  void savePreference({
                    viewSettings: {
                      ...preference?.viewSettings,
                      [viewID]: { ...preference?.viewSettings?.[viewID], columns: columnSettings },
                    },
                  })
                    .then(() => setShowColumns(false))
                    .catch((e) => setError(e.message))
                }
              >
                Save my columns
              </button>
            </fieldset>
          )}
        </WorkspaceFilterPanel>
      )}
      {kind === 'list' && (
        <div className="workspace-table-scroll">
          <table className="workspace-task-table">
            <colgroup>
              <col style={{ minWidth: 340, width: 400 }} />
              {columns.map((column) => (
                <col key={column.key} style={{ width: columnSettings[column.key]?.width ?? 160 }} />
              ))}
              <col style={{ width: 55 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Task</th>
                {columns.map((column) => (
                  <th scope="col" key={column.key}>
                    {column.name}
                  </th>
                ))}
                <th scope="col">
                  {isOwner && (
                    <button
                      type="button"
                      aria-label="Add field"
                      onClick={() => setFieldManager(true)}
                    >
                      ＋
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((grouping) => (
                <BoardSectionRows
                  key={grouping.key}
                  name={grouping.name}
                  columnCount={columns.length + 2}
                  collapsed={collapsed.includes(grouping.key)}
                  toggle={() =>
                    setCollapsed((values) =>
                      values.includes(grouping.key)
                        ? values.filter((value) => value !== grouping.key)
                        : [...values, grouping.key],
                    )
                  }
                >
                  {sorted(roots.filter((task) => groupFor(task) === grouping.key)).map((task) => (
                    <TaskRows
                      key={task.id}
                      parent={row(task)}
                      childrenRows={
                        showChildren && expanded.includes(task.id)
                          ? filtered
                              .filter((child) => child.parent === task.id)
                              .map((child) => row(child, true))
                              .concat(
                                canEdit && task.canEdit
                                  ? [
                                      <tr key={`create-child-${task.id}`}>
                                        <td colSpan={columns.length + 2}>
                                          <InlineTaskEntry
                                            label={`Add subtask to ${task.title}`}
                                            create={(title) => createInline(title, '', task)}
                                          />
                                        </td>
                                      </tr>,
                                    ]
                                  : [],
                              )
                          : []
                      }
                    />
                  ))}
                  {canEdit && (
                    <tr>
                      <td colSpan={columns.length + 2}>
                        <InlineTaskEntry
                          label={`Add task in ${grouping.name}`}
                          create={(title) => createInline(title, grouping.key)}
                        />
                      </td>
                    </tr>
                  )}
                </BoardSectionRows>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {kind === 'board' && (
        <div className="workspace-kanban">
          {groups.map((grouping) => (
            <section
              key={grouping.key}
              onDragOver={(event) => {
                if (canEdit) event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                const task = tasks.find(
                  (task) => String(task.id) === event.dataTransfer.getData('text/plain'),
                )
                if (task && canEdit) void move(task, grouping.key)
              }}
            >
              <h3>
                {grouping.name}
                <small>{roots.filter((task) => groupFor(task) === grouping.key).length}</small>
              </h3>
              {sorted(roots.filter((task) => groupFor(task) === grouping.key)).map((task) => (
                <article
                  key={task.id}
                  draggable={canEdit && task.canEdit}
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', String(task.id))}
                >
                  <button
                    type="button"
                    className="workspace-task-title"
                    onClick={() => onSelect(task)}
                  >
                    {task.title}
                  </button>
                  <div>
                    <span className={`workspace-status status-${task.status}`}>
                      {statuses[task.status as keyof typeof statuses]}
                    </span>
                    <small>
                      {task.assigneeLabel ?? 'Unassigned'} · {day(task.dueDate) || 'No date'}
                    </small>
                  </div>
                  <small>
                    {
                      tasks.filter((child) => child.parent === task.id && child.status === 'done')
                        .length
                    }
                    /{tasks.filter((child) => child.parent === task.id).length} subtasks
                  </small>
                  {canEdit && task.canEdit && (
                    <select
                      aria-label={`Move ${task.title} to`}
                      value={groupFor(task)}
                      onChange={(event) => void move(task, event.target.value)}
                    >
                      {groups.map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
      {kind === 'calendar' && (
        <CalendarView
          tasks={filtered.filter((task) => showChildren || !task.parent)}
          anchor={anchor}
          mode={calendarMode}
          onAnchor={(value) => {
            setAnchor(value)
            url('calendarDate', value)
          }}
          onMode={(value) => {
            setCalendarMode(value)
            url('calendarRange', value)
          }}
          onSelect={onSelect}
          patch={patch}
          canEdit={canEdit}
        />
      )}
      {['timeline', 'gantt'].includes(kind) && (
        <TimelineView
          tasks={sorted(filtered.filter((task) => showChildren || !task.parent)).sort((a, b) =>
            groupFor(a).localeCompare(groupFor(b)),
          )}
          groupLabel={(task) =>
            groups.find((item) => item.key === groupFor(task))?.name ?? 'Unsectioned'
          }
          gantt={kind === 'gantt'}
          onSelect={onSelect}
          patch={patch}
          canEdit={canEdit}
          baseline={baseline}
          toolbar={
            <>
              {isOwner && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void workspaceDialog({
                      title: 'Save scheduling baseline',
                      description:
                        'Keep a date snapshot for comparison. It will continue to follow task permissions.',
                      fields: [{ name: 'name', label: 'Baseline name', required: true }],
                      saveLabel: 'Save baseline',
                      onSave: async (values) => {
                        await reviewAPI(api, `task-workspace/boards/${id}/baseline`, 'POST', {
                          name: values.name,
                        })
                        await load()
                      },
                    })
                  }
                >
                  Save baseline
                </button>
              )}
              <select
                aria-label="Compare baseline"
                value={baseline?.id ?? ''}
                onChange={(event) => {
                  if (!event.target.value) {
                    setBaseline(undefined)
                    return
                  }
                  void reviewAPI(api, `task-workspace/boards/${id}/baselines/${event.target.value}`)
                    .then(setBaseline)
                    .catch((e) => setError(e.message))
                }}
              >
                <option value="">No baseline comparison</option>
                {baselines.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </>
          }
        />
      )}
      {kind === 'overview' && (
        <section className="workspace-overview">
          <h3>About this board</h3>
          <p>{board?.description || 'Add a description in Board settings.'}</p>
          <p>
            {board?.inheritProject
              ? 'Project members inherit access.'
              : 'This board has its own membership.'}{' '}
            Administrators retain oversight.
          </p>
          <p>Owner: {board?.ownerLabel ?? `#${board?.owner}`}</p>
          <details>
            <summary>People with access ({people.length})</summary>
            <ul className="workspace-overview-members">
              {people.map((person) => (
                <li key={person.id}>{person.label}</li>
              ))}
            </ul>
          </details>
          {summary?.complete && (
            <>
              <p>
                First start:{' '}
                {tasks
                  .map((task) => day(task.startDate))
                  .filter(Boolean)
                  .sort()[0] || 'Not scheduled'}{' '}
                · Latest deadline:{' '}
                {tasks
                  .map((task) => day(task.dueDate))
                  .filter(Boolean)
                  .sort()
                  .at(-1) || 'Not scheduled'}
              </p>
              <label>
                Completion: {tasks.filter((task) => task.status === 'done').length} of{' '}
                {tasks.length} tasks{' '}
                <progress
                  max={Math.max(tasks.length, 1)}
                  value={tasks.filter((task) => task.status === 'done').length}
                />
              </label>
            </>
          )}
          <BoardMetrics summary={summary} />
          <BoardActivity api={api} board={id} />
        </section>
      )}
      {kind === 'dashboard' && (
        <>
          <BoardMetrics summary={summary} />
          <div className="workspace-dashboard-grid">
            <section>
              <h3>By status</h3>
              {Object.entries(summary?.complete ? summary.counts : {}).map(([key, count]) => (
                <div className="workspace-metric-row" key={key}>
                  <span>{statuses[key as keyof typeof statuses]}</span>
                  <meter min={0} max={tasks.length || 1} value={Number(count)} />
                  <strong>{String(count)}</strong>
                </div>
              ))}
            </section>
            <section>
              <h3>By assignee</h3>
              {Object.entries(summary?.complete ? summary.assignees : {}).map(
                ([key, value]: any) => (
                  <p key={key}>
                    {people.find((person) => String(person.id) === key)?.label ??
                      (key === 'unassigned' ? 'Unassigned' : 'Assigned user')}
                    : {value.tasks} tasks · {(value.seconds / 3600).toFixed(2)} hours
                  </p>
                ),
              )}
            </section>
          </div>
        </>
      )}
      {kind === 'files' && (
        <WorkspaceFiles api={api} board={Number(id)} linked={tasks} canUpload={canEdit} />
      )}
      {kind === 'page' && view && (
        <BoardPage key={view.id} api={api} view={view} board={Number(id)} canEdit={canEdit} />
      )}
      {kind === 'messages' && (
        <BoardMessages
          api={api}
          board={Number(id)}
          canComment={board?.workspaceRole !== 'viewer' && !board?.archived && !project?.archived}
        />
      )}
      {kind === 'embed' && view && (
        <EmbedView api={api} board={Number(id)} view={view} owner={isOwner} onSaved={load} />
      )}
      {kind === 'workload' && (
        <WorkloadView api={api} tasks={tasks} people={people} canEdit={canEdit} onChange={load} />
      )}
      {kind === 'timesheets' && (
        <TimesheetView
          api={api}
          tasks={tasks}
          people={people}
          onSelect={onSelect}
          onChange={load}
          timezone={summary?.timezone ?? 'UTC'}
          ready={!loading}
        />
      )}
      {['list', 'board'].includes(kind) && canEdit && (
        <details className="workspace-section-settings">
          <summary>Manage sections</summary>
          <div className="workspace-add-section">
            <label>
              New section
              <input value={sectionName} onChange={(event) => setSectionName(event.target.value)} />
            </label>
            <button
              type="button"
              aria-label="Add section"
              disabled={busy || !sectionName.trim() || !canEdit}
              onClick={() =>
                void run(async () => {
                  await reviewAPI(api, 'task-sections', 'POST', {
                    board: Number(id),
                    name: sectionName,
                    position: sections.length,
                  })
                  setSectionName('')
                })
              }
            >
              ＋ Add section
            </button>
          </div>
          {sections.map((section, index) => (
            <div className="task-workspace-toolbar" key={section.id}>
              <input
                aria-label={`Section ${section.name}`}
                defaultValue={section.name}
                onBlur={(event) => {
                  if (event.target.value.trim() && event.target.value !== section.name)
                    void run(() =>
                      reviewAPI(api, `task-sections/${section.id}`, 'PATCH', {
                        name: event.target.value.trim(),
                        expectedUpdatedAt: section.updatedAt,
                      }),
                    )
                }}
              />
              <button
                type="button"
                disabled={busy || index === 0}
                onClick={() =>
                  void run(() =>
                    reviewAPI(api, `task-sections/${section.id}`, 'PATCH', {
                      position: sections[index - 1].position - 1,
                      expectedUpdatedAt: section.updatedAt,
                    }),
                  )
                }
              >
                Move up
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm('Archive this section? Tasks move to Unsectioned.'))
                    void run(() =>
                      reviewAPI(api, `task-sections/${section.id}`, 'PATCH', {
                        archived: true,
                        expectedUpdatedAt: section.updatedAt,
                      }),
                    )
                }}
              >
                Archive section
              </button>
            </div>
          ))}
        </details>
      )}
      {settings && board && (
        <BoardSettings
          api={api}
          board={board}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false)
            void load()
          }}
        />
      )}
      {fieldManager && (
        <FieldManager
          api={api}
          board={Number(id)}
          onClose={() => setFieldManager(false)}
          onSaved={load}
        />
      )}{' '}
      {viewManager && (
        <ViewManager
          api={api}
          board={Number(id)}
          views={views}
          onClose={() => setViewManager(false)}
          onSaved={load}
        />
      )}{' '}
      {sharing && board && (
        <ProjectBoardSharing
          api={api}
          board={board}
          onClose={() => setSharing(false)}
          onSaved={load}
        />
      )}
    </section>
  )
}
function BoardSectionRows({
  name,
  columnCount,
  collapsed,
  toggle,
  children,
}: {
  name: string
  columnCount: number
  collapsed: boolean
  toggle: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <tr className="workspace-section-row">
        <th scope="rowgroup" colSpan={columnCount}>
          <button type="button" aria-expanded={!collapsed} onClick={toggle}>
            {collapsed ? '▸' : '▾'} {name}
          </button>
        </th>
      </tr>
      {!collapsed && children}
    </>
  )
}
function TaskRows({
  parent,
  childrenRows,
}: {
  parent: React.ReactNode
  childrenRows: React.ReactNode[]
}) {
  return (
    <>
      {parent}
      {childrenRows}
    </>
  )
}
function BoardMetrics({ summary }: { summary: any }) {
  const counts = summary?.counts ?? {}
  return (
    <div className="workspace-summary-tiles">
      {[
        ['Tasks', Object.values(counts).reduce((sum: number, n) => sum + Number(n), 0)],
        [
          'Unfinished',
          (counts.open ?? 0) + (counts['in-progress'] ?? 0) + (counts['ready-for-review'] ?? 0),
        ],
        ['Overdue', summary?.overdue ?? 0],
        ['Recorded hours', ((summary?.seconds ?? 0) / 3600).toFixed(2)],
      ].map(([label, value]) => (
        <article key={String(label)}>
          <small>{String(label)}</small>
          <strong>{summary?.complete ? String(value) : '…'}</strong>
        </article>
      ))}
    </div>
  )
}
function BoardActivity({ api, board }: { api: string; board: string }) {
  const [activity, setActivity] = useState<any[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    void reviewAPI<any>(
      api,
      `task-board-activity?${query({ board: { equals: board } }, { limit: '10' })}`,
    )
      .then((data) => setActivity(data.docs))
      .catch((e) => setError(e.message))
  }, [api, board])
  return (
    <section>
      <h3>Recent activity</h3>
      {error && <p role="alert">{error}</p>}
      <ul>
        {activity.map((item) => (
          <li key={item.id}>
            {item.message} <small>{new Date(item.createdAt).toLocaleString()}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}
function CalendarView({
  tasks,
  anchor,
  mode,
  onAnchor,
  onMode,
  onSelect,
  patch,
  canEdit,
}: {
  tasks: WorkTask[]
  anchor: string
  mode: string
  onAnchor: (value: string) => void
  onMode: (value: string) => void
  onSelect: (task: Task) => void
  patch: (task: Task, data: object) => Promise<void>
  canEdit: boolean
}) {
  const chosen = new Date(anchor + 'T12:00:00'),
    first =
      mode === 'week'
        ? new Date(
            chosen.getFullYear(),
            chosen.getMonth(),
            chosen.getDate() - ((chosen.getDay() + 6) % 7),
          )
        : new Date(chosen.getFullYear(), chosen.getMonth(), 1),
    start =
      mode === 'week'
        ? localTaskDay(first)
        : localTaskDay(
            new Date(
              first.getFullYear(),
              first.getMonth(),
              first.getDate() - ((first.getDay() + 6) % 7),
            ),
          ),
    days = Array.from({ length: mode === 'week' ? 7 : 42 }, (_, index) => nextTaskDay(start, index))
  return (
    <section>
      <div className="task-workspace-toolbar">
        <input
          aria-label="Calendar date"
          type="date"
          value={anchor}
          onChange={(e) => onAnchor(e.target.value || today())}
        />
        <select aria-label="Calendar range" value={mode} onChange={(e) => onMode(e.target.value)}>
          <option value="month">Month</option>
          <option value="week">Week</option>
        </select>
      </div>
      <div className="workspace-calendar-scroll">
        <div className="workspace-calendar">
          {days.map((date) => (
            <section key={date} aria-label={date}>
              <h4>{date}</h4>
              {tasks
                .filter((task) => day(task.dueDate) === date)
                .map((task) => (
                  <button key={task.id} type="button" onClick={() => onSelect(task)}>
                    {task.parent ? '↳ ' : ''}
                    {task.title}
                    {task.parent && (
                      <small>
                        Subtask of{' '}
                        {tasks.find((parent) => parent.id === task.parent)?.title ??
                          `Task #${task.parent}`}
                      </small>
                    )}
                  </button>
                ))}
            </section>
          ))}
        </div>
      </div>
      <h3>Undated tasks</h3>
      {tasks
        .filter((task) => !task.dueDate)
        .map((task) => (
          <div className="task-workspace-toolbar" key={task.id}>
            <button type="button" onClick={() => onSelect(task)}>
              {task.title}
              {task.parent && (
                <small>
                  {' '}
                  · Subtask of{' '}
                  {tasks.find((parent) => parent.id === task.parent)?.title ??
                    `Task #${task.parent}`}
                </small>
              )}
            </button>
            {canEdit && task.canEdit && (
              <input
                type="date"
                aria-label={`Schedule ${task.title}`}
                onChange={(e) =>
                  void patch(task, {
                    dueDate: e.target.value ? `${e.target.value}T12:00:00.000Z` : null,
                  })
                }
              />
            )}
          </div>
        ))}
    </section>
  )
}
function TimelineView({
  tasks,
  gantt,
  onSelect,
  patch,
  canEdit,
  baseline,
  toolbar,
  groupLabel,
}: {
  tasks: WorkTask[]
  gantt: boolean
  onSelect: (task: Task) => void
  patch: (task: Task, data: object) => Promise<void>
  canEdit: boolean
  baseline: any
  toolbar: React.ReactNode
  groupLabel: (task: WorkTask) => string
}) {
  const [start, setStart] = useState(today()),
    [length, setLength] = useState(30)
  const end = nextTaskDay(start, length - 1),
    offset = (date: string) =>
      Math.max(
        0,
        Math.min(length - 1, Math.round((Date.parse(date) - Date.parse(start)) / 86400000)),
      )
  return (
    <section>
      <div className="task-workspace-toolbar">
        {gantt ? toolbar : null}
        <label>
          Range start{' '}
          <input
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value || today())}
          />
        </label>
        <label>
          Visible days{' '}
          <select value={length} onChange={(event) => setLength(Number(event.target.value))}>
            <option value={30}>30</option>
            <option value={90}>90</option>
            <option value={365}>365</option>
          </select>
        </label>
        <p>
          {start} — {nextTaskDay(start, length - 1)} · Calendar dates · explicit rescheduling
        </p>
      </div>
      <div className="workspace-timeline-scroll">
        <div className="workspace-timeline" style={{ minWidth: Math.max(850, length * 24) }}>
          <div className="workspace-timeline-scale">
            <span>Task / dates</span>
            {Array.from({ length: length }, (_, index) => (
              <small key={index}>{nextTaskDay(start, index).slice(5)}</small>
            ))}
          </div>
          {tasks.map((task, index) => {
            const from = day(task.startDate) || day(task.dueDate),
              to = day(task.dueDate) || from,
              before = baseline?.snapshot?.find((item: any) => item.id === task.id),
              conflict =
                gantt &&
                task.dependencies.some(
                  (dependency) =>
                    dependency.dueDate &&
                    from &&
                    day(dependency.dueDate) >= from &&
                    dependency.status !== 'done',
                )
            return (
              <div
                key={task.id}
                className="workspace-timeline-row"
                style={{ gridTemplateColumns: `280px repeat(${length},24px)` }}
              >
                <div>
                  {(index === 0 || groupLabel(tasks[index - 1]) !== groupLabel(task)) && (
                    <strong className="workspace-timeline-group">{groupLabel(task)}</strong>
                  )}
                  <button type="button" onClick={() => onSelect(task)}>
                    {task.parent ? '↳ ' : ''}
                    {task.title}
                  </button>
                  {task.parent && (
                    <small>
                      Subtask of{' '}
                      {tasks.find((parent) => parent.id === task.parent)?.title ??
                        `Task #${task.parent}`}
                    </small>
                  )}
                  {canEdit && task.canEdit && (
                    <div>
                      <input
                        aria-label={`Start date for ${task.title}`}
                        type="date"
                        value={day(task.startDate)}
                        onChange={(e) =>
                          void patch(task, {
                            startDate: e.target.value ? `${e.target.value}T12:00:00.000Z` : null,
                          })
                        }
                      />
                      <input
                        aria-label={`End date for ${task.title}`}
                        type="date"
                        value={day(task.dueDate)}
                        onChange={(e) =>
                          void patch(task, {
                            dueDate: e.target.value ? `${e.target.value}T12:00:00.000Z` : null,
                          })
                        }
                      />
                    </div>
                  )}
                  {gantt &&
                    task.dependencies.map((dependency) => (
                      <small key={dependency.id}>
                        ← {dependency.unavailable ? 'Restricted dependency' : dependency.title}
                      </small>
                    ))}
                  {conflict && <strong role="status">Dependency date conflict</strong>}
                  {before && (
                    <small>
                      Baseline: {day(before.startDate) || '—'} — {day(before.dueDate) || '—'}
                    </small>
                  )}
                </div>
                {from && from <= end && to >= start ? (
                  <div
                    className={`workspace-date-bar ${task.milestone ? 'milestone' : ''}`}
                    title={`${task.title}: ${from} — ${to}`}
                    style={{
                      gridColumn: `${offset(from) + 2} / span ${Math.max(1, offset(to) - offset(from) + 1)}`,
                    }}
                  >
                    {task.milestone ? '◆' : task.title}
                  </div>
                ) : (
                  <small>{from ? 'Outside selected range' : 'Undated'}</small>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
function WorkloadView({
  api,
  tasks,
  people,
  onChange,
}: {
  api: string
  tasks: WorkTask[]
  people: any[]
  canEdit: boolean
  onChange: () => void
}) {
  const [capacities, setCapacities] = useState<any[]>([]),
    [week, setWeek] = useState(today()),
    [error, setError] = useState(''),
    { user } = useAuth()
  useEffect(() => {
    void reviewAll<any>(api, 'task-capacities', {})
      .then(setCapacities)
      .catch((e) => setError(e.message))
  }, [api])
  const date = new Date(week + 'T12:00:00'),
    monday = localTaskDay(
      new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)),
    ),
    sunday = nextTaskDay(monday, 6)
  return (
    <section>
      <h3>Weekly workload</h3>
      <label>
        Week containing
        <input type="date" value={week} onChange={(e) => setWeek(e.target.value || today())} />
      </label>
      <p>
        {monday} — {sunday}. Estimates are spread across scheduled working days; unfinished undated
        work is shown separately.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="workspace-workload">
        {people.map((person) => {
          const capacity = capacities.find((item) => item.user === person.id),
            working = capacity?.weekdays ?? [1, 2, 3, 4, 5],
            assigned = tasks.filter((task) => task.assignee === person.id && task.status !== 'done')
          let estimated = 0,
            unestimated = 0,
            undated = 0
          for (const task of assigned) {
            const field = task.fields.find(
                (field) =>
                  field.definition.systemKey === 'estimated-hours' &&
                  field.definition.kind === 'number',
              ),
              hours = typeof field?.value === 'number' ? field.value : null
            if (!task.dueDate) {
              undated++
              continue
            }
            const from = day(task.startDate) || day(task.dueDate),
              to = day(task.dueDate)
            if (to < monday || from > sunday) continue
            if (hours === null) {
              unestimated++
              continue
            }
            let all = 0,
              inside = 0
            for (
              let at = from, iterations = 0;
              at <= to && iterations < 3660;
              at = nextTaskDay(at, 1), iterations++
            ) {
              if (working.includes(new Date(at + 'T12:00:00').getDay())) {
                all++
                if (at >= monday && at <= sunday) inside++
              }
            }
            estimated += all ? (hours * inside) / all : hours
          }
          const available = capacity?.weeklyHours ?? 40
          return (
            <article key={person.id}>
              <h4>{person.label}</h4>
              <strong>
                {estimated.toFixed(1)} / {available} hours
              </strong>
              <meter min={0} max={Math.max(available, estimated, 1)} value={estimated} />
              <p>
                {unestimated} unestimated · {undated} undated
              </p>
              {(person.id === user?.id || user?.role === 'administrator') && (
                <button
                  type="button"
                  onClick={() =>
                    void workspaceDialog({
                      title: `Capacity for ${person.label}`,
                      fields: [
                        {
                          name: 'hours',
                          label: 'Weekly capacity in hours',
                          value: String(available),
                          type: 'number',
                          min: 0,
                          max: 168,
                          required: true,
                        },
                        {
                          name: 'days',
                          label: 'Working days',
                          value: working.join(','),
                          type: 'weekdays',
                        },
                      ],
                      onSave: async (values) => {
                        const response = await reviewAPI<any>(
                          api,
                          `task-capacities${capacity ? `/${capacity.id}` : ''}`,
                          capacity ? 'PATCH' : 'POST',
                          {
                            user: person.id,
                            weeklyHours: Number(values.hours),
                            weekdays: values.days ? values.days.split(',').map(Number) : [],
                            expectedUpdatedAt: capacity?.updatedAt,
                          },
                        )
                        setCapacities((items) => [
                          ...items.filter((item) => item.user !== person.id),
                          response.doc,
                        ])
                        onChange()
                      },
                    })
                  }
                >
                  Edit capacity
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
function TimesheetView({
  api,
  tasks,
  people,
  onSelect,
  onChange,
  timezone,
  ready,
}: {
  api: string
  tasks: WorkTask[]
  people: any[]
  onSelect: (task: Task) => void
  onChange: () => void
  timezone: string
  ready: boolean
}) {
  const [week, setWeek] = useState(siteCalendarDay(new Date(), timezone)),
    [error, setError] = useState(''),
    [rows, setRows] = useState<any[]>([]),
    [loading, setLoading] = useState(false)
  const version = tasks.map((task) => `${task.id}:${task.updatedAt}`).join(',')
  useEffect(() => {
    let current = true
    setRows([])
    setLoading(true)
    if (!ready)
      return () => {
        current = false
      }
    const load = async () => {
      const collected: any[] = []
      for (const task of tasks) {
        let page = 1,
          totalPages = 1
        do {
          const result = await reviewAPI<any>(
            api,
            `task-workspace/tasks/${task.id}/time?week=${week}&page=${page}`,
          )
          if (!current) return
          for (const entry of result.entries) collected.push({ ...entry, taskRecord: task })
          totalPages = result.totalPages
          page++
        } while (page <= totalPages)
        if (current) setRows([...collected])
      }
      if (current) setError('')
    }
    void load()
      .catch((error) => {
        if (current) {
          setError(error.message)
          setRows([])
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [api, version, week, timezone, ready])
  const window = siteWeek(week, timezone)
  const entries = rows
    .map((entry) => ({
      ...entry,
      weekSeconds: secondsInWindow(
        entry.startedAt,
        entry.endedAt ?? new Date().toISOString(),
        window,
      ),
    }))
    .filter((entry) => entry.weekSeconds > 0)
  return (
    <section>
      <h3>Timesheets</h3>
      <label>
        Week containing
        <input
          type="date"
          value={week}
          onChange={(e) => setWeek(e.target.value || siteCalendarDay(new Date(), timezone))}
        />
      </label>
      <p>Detailed entries are visible to their owner and eligible workspace managers.</p>
      <p>
        {window.monday} — {window.sunday} · {timezone}. Sessions crossing a week boundary are split
        for reporting.
      </p>
      {loading && <p role="status">Loading accessible time entries…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="workspace-table-scroll">
        <table className="workspace-task-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Task</th>
              <th>Started</th>
              <th>Hours</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {people.find((person) => person.id === entry.user)?.label ??
                    `User #${entry.user}`}
                </td>
                <td>
                  <button type="button" onClick={() => onSelect(entry.taskRecord)}>
                    {entry.taskRecord.title}
                  </button>
                </td>
                <td>
                  {new Date(entry.startedAt).toLocaleString(undefined, { timeZone: timezone })}
                </td>
                <td>{entry.endedAt ? (entry.weekSeconds / 3600).toFixed(2) : 'Running'}</td>
                <td>{entry.note}</td>
                <td>
                  {entry.endedAt && (
                    <button
                      type="button"
                      onClick={() =>
                        void workspaceDialog({
                          title: 'Correct time entry',
                          description:
                            'Times are entered in your local timezone. Reports use the site timezone. Existing timestamps are preserved when unchanged.',
                          fields: [
                            {
                              name: 'start',
                              label: 'Started (your local time)',
                              type: 'datetime-local',
                              value: localTimeInput(entry.startedAt),
                              required: true,
                            },
                            {
                              name: 'end',
                              label: 'Ended (your local time)',
                              type: 'datetime-local',
                              value: localTimeInput(entry.endedAt),
                              required: true,
                            },
                            {
                              name: 'note',
                              label: 'Note',
                              type: 'textarea',
                              value: entry.note ?? '',
                            },
                            { name: 'reason', label: 'Audit reason', required: true },
                          ],
                          saveLabel: 'Save correction',
                          onSave: async (values) => {
                            await reviewAPI(
                              api,
                              `task-workspace/tasks/${entry.taskRecord.id}`,
                              'POST',
                              {
                                action: 'save-time',
                                entry: entry.id,
                                startedAt:
                                  values.start === localTimeInput(entry.startedAt)
                                    ? entry.startedAt
                                    : parseLocalTime(values.start),
                                endedAt:
                                  values.end === localTimeInput(entry.endedAt)
                                    ? entry.endedAt
                                    : parseLocalTime(values.end),
                                note: values.note,
                                reason: values.reason,
                                expectedUpdatedAt: entry.updatedAt,
                              },
                            )
                            onChange()
                          },
                        })
                      }
                    >
                      Correct entry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !entries.length && <p>No accessible entries in this week.</p>}
    </section>
  )
}
