'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize board routes and remote records. */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@payloadcms/ui'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { query, reviewAll, reviewAPI, statuses, taskSearchTerms, type Task } from './client'
import { localTaskDay, nextTaskDay } from './dashboard-model'

export type Board = {
  id: number
  name: string
  description?: string
  owner: number
  ownerLabel?: string
  visibility: 'private' | 'team'
  archived?: boolean
  updatedAt: string
  workspaceRole?: string
}
type Person = { id: number; label: string; username?: string }
type Member = { id: number; user: number; role: string }
type Preference = { id: number; board: number; favorite?: boolean; view?: string }
type Section = { id: number; name: string; position: number; archived?: boolean }
type Placement = {
  id: number
  task: number
  board: number
  section?: number
  position: number
  updatedAt: string
}
type Page<T> = { docs: T[]; totalPages: number; totalDocs: number }
const viewURL = (admin: string, board?: number) =>
  `${admin}/collections/review-tasks?workspace=boards${board ? `&board=${board}` : ''}`

export function WorkspaceBoards({
  api,
  admin,
  boardID,
  onSelect,
  onCreate,
  refreshKey,
}: {
  api: string
  admin: string
  boardID?: string
  onSelect: (task: Task) => void
  onCreate: () => void
  refreshKey: number
}) {
  const { user } = useAuth()
  const [boards, setBoards] = useState<Board[]>([]),
    [preferences, setPreferences] = useState<Preference[]>([])
  const [search, setSearch] = useState(''),
    [archived, setArchived] = useState(false),
    [favorites, setFavorites] = useState(false)
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false)
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [counts, setCounts] = useState<Record<number, number>>({})
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const prefs = await reviewAll<Preference>(api, 'task-board-preferences', {})
      const terms = taskSearchTerms(search)
      const result = await reviewAPI<Page<Board>>(
        api,
        `task-boards?${query(
          {
            and: [
              { archived: { equals: archived } },
              ...terms.map((term) => ({ name: { contains: term } })),
              ...(favorites ? [{ 'preferences.favoriteUser': { equals: user?.id } }] : []),
            ],
          },
          { page: String(page), limit: '12' },
        )}`,
      )
      setBoards(result.docs)
      setPreferences(prefs)
      setPages(result.totalPages)
      const totals = await Promise.all(
        result.docs.map(async (board) => {
          const total = await reviewAPI<{ totalDocs: number }>(
            api,
            `review-tasks/count?${query({ and: [{ boards: { equals: board.id } }, { parent: { exists: false } }, { archived: { not_equals: true } }, { status: { not_equals: 'done' } }] })}`,
          )
          return [board.id, total.totalDocs] as const
        }),
      )
      setCounts(Object.fromEntries(totals))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, search, archived, favorites, page, user])
  useEffect(() => {
    if (!boardID) void load()
  }, [boardID, load, refreshKey])
  useEffect(() => {
    const refresh = () => {
      if (!boardID) void load()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [load, boardID])
  if (boardID)
    return (
      <BoardDetail
        key={boardID}
        api={api}
        admin={admin}
        id={boardID}
        onSelect={onSelect}
        onCreate={onCreate}
        refreshKey={refreshKey}
      />
    )
  return (
    <section>
      <header className="task-workspace-heading">
        <div>
          <h2>Boards</h2>
          <p>Organize shared work, your way.</p>
        </div>
        <button className="task-primary" type="button" onClick={() => setCreating(true)}>
          Create board
        </button>
      </header>
      <div className="task-workspace-toolbar">
        <label>
          Find a board
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={favorites}
            onChange={(e) => {
              setFavorites(e.target.checked)
              setPage(1)
            }}
          />{' '}
          Favorites
        </label>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked)
              setPage(1)
            }}
          />{' '}
          Archived
        </label>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {loading && <p role="status">Loading boards…</p>}
      <div className="task-board-directory">
        {boards.map((board) => (
          <article key={board.id}>
            <div className="task-workspace-heading">
              <span className="task-visibility">
                {board.visibility === 'team' ? 'Team-wide' : 'Private'} · {board.workspaceRole}
              </span>
              <button
                type="button"
                aria-label={`${preferences.some((p) => p.board === board.id && p.favorite) ? 'Unfavorite' : 'Favorite'} ${board.name}`}
                onClick={() => {
                  const pref = preferences.find((p) => p.board === board.id)
                  void reviewAPI(
                    api,
                    `task-board-preferences${pref ? `/${pref.id}` : ''}`,
                    pref ? 'PATCH' : 'POST',
                    { board: board.id, favorite: !pref?.favorite },
                  )
                    .then(load)
                    .catch((e) => setError(e.message))
                }}
              >
                {preferences.some((p) => p.board === board.id && p.favorite) ? '★' : '☆'}
              </button>
            </div>
            <h3>
              <Link href={viewURL(admin, board.id)}>{board.name}</Link>
            </h3>
            <p>{board.description || 'A place for your team’s next steps.'}</p>
            <strong>{counts[board.id] ?? '…'} unfinished</strong>
            <small>Owned by {board.ownerLabel ?? `User #${board.owner}`}</small>
          </article>
        ))}
      </div>
      {!loading && !error && !boards.length && (
        <p>No boards match this view. Create a board to get started.</p>
      )}
      <nav aria-label="Board pages">
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
      {creating && (
        <BoardSettings
          api={api}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            void load()
          }}
        />
      )}
    </section>
  )
}

function BoardSettings({
  api,
  board,
  onClose,
  onSaved,
}: {
  api: string
  board?: Board
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(board?.name ?? ''),
    [description, setDescription] = useState(board?.description ?? ''),
    [visibility, setVisibility] = useState(board?.visibility ?? 'private')
  const [created, setCreated] = useState<Board | undefined>(board),
    [people, setPeople] = useState<Person[]>([]),
    [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState(''),
    [person, setPerson] = useState(''),
    [role, setRole] = useState('editor'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [owner, setOwner] = useState(String(board?.owner ?? '')),
    [archived, setArchived] = useState(!!board?.archived)
  const loadMembers = useCallback(async () => {
    if (created)
      setMembers(
        await reviewAll<Member>(api, 'task-board-memberships', { board: { equals: created.id } }),
      )
  }, [api, created])
  useEffect(() => {
    void loadMembers().catch((e) => setError(e.message))
  }, [loadMembers])
  useEffect(() => {
    let current = true
    void reviewAPI<{ docs: Person[] }>(
      api,
      `task-boards/people?search=${encodeURIComponent(search)}`,
    )
      .then((r) => {
        if (current) setPeople(r.docs)
      })
      .catch((e) => setError(e.message))
    return () => {
      current = false
    }
  }, [api, search])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const dirty =
    name !== (board?.name ?? '') ||
    description !== (board?.description ?? '') ||
    visibility !== (board?.visibility ?? 'private') ||
    archived !== !!board?.archived ||
    (board && owner !== String(board.owner))
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  return (
    <EditorDialog
      open
      title={board ? 'Board settings' : 'Create board'}
      onClose={() => {
        if (!dirty || window.confirm('Discard unsaved board changes?')) onClose()
      }}
    >
      <div className="task-workspace-dialog">
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={busy}>
          <label>
            Board name
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Description
            <textarea
              value={description}
              maxLength={10000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Visibility
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'private' | 'team')}
            >
              <option value="private">Private — invited members</option>
              <option value="team">Team-wide — everyone signed in can view</option>
            </select>
          </label>
          <p>
            Administrators retain oversight of private boards. Changes to membership or visibility
            affect every task shared here, including comments and subtasks.
          </p>
          {board && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />{' '}
                Archive board
              </label>
              <label>
                Transfer ownership
                <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value={board.owner}>Current owner</option>
                  {people
                    .filter((p) => p.id !== board.owner)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          <button
            type="button"
            className="task-primary"
            disabled={!name.trim()}
            onClick={() =>
              void run(async () => {
                const result = await reviewAPI<{ doc: Board }>(
                  api,
                  `task-boards${created ? `/${created.id}` : ''}`,
                  created ? 'PATCH' : 'POST',
                  {
                    name,
                    description,
                    visibility,
                    archived,
                    ...(board ? { owner: Number(owner), expectedUpdatedAt: board.updatedAt } : {}),
                  },
                )
                setCreated(result.doc)
                if (person)
                  await reviewAPI(api, 'task-board-memberships', 'POST', {
                    board: result.doc.id,
                    user: Number(person),
                    role,
                  })
                onSaved()
              })
            }
          >
            {busy ? 'Saving…' : board ? 'Save board' : 'Create board'}
          </button>
        </fieldset>
        <h3>Members</h3>
        <p>
          Only owners can invite members or change roles. Adding a member grants access to all
          shared task discussions on this board.
        </p>
        <label>
          Find a person
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="task-workspace-toolbar">
          <label>
            Person
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Choose a person</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.username ? ` (@${p.username})` : ' — no username yet'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {['editor', 'commenter', 'viewer'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          {created && (
            <button
              type="button"
              disabled={!person || busy}
              onClick={() =>
                void run(async () => {
                  await reviewAPI(api, 'task-board-memberships', 'POST', {
                    board: created.id,
                    user: Number(person),
                    role,
                  })
                  setPerson('')
                  await loadMembers()
                })
              }
            >
              Add member
            </button>
          )}
        </div>
        {!created && (
          <p>
            The selected person will be added when you create the board. You can add more in Board
            settings.
          </p>
        )}
        <ul className="task-member-list">
          {members.map((member) => (
            <li key={member.id}>
              <span>
                {people.find((p) => p.id === member.user)?.label ?? `User #${member.user}`}
              </span>
              <select
                aria-label={`Role for user ${member.user}`}
                value={member.role}
                disabled={busy}
                onChange={(e) =>
                  void run(async () => {
                    await reviewAPI(api, `task-board-memberships/${member.id}`, 'PATCH', {
                      role: e.target.value,
                    })
                    await loadMembers()
                  })
                }
              >
                {['editor', 'commenter', 'viewer'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Remove this member’s board access?'))
                    void run(async () => {
                      await reviewAPI(api, `task-board-memberships/${member.id}`, 'DELETE')
                      await loadMembers()
                    })
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </EditorDialog>
  )
}

function BoardDetail({
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
  onCreate: () => void
  refreshKey: number
}) {
  const { user } = useAuth()
  const [board, setBoard] = useState<Board>(),
    [sections, setSections] = useState<Section[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [placements, setPlacements] = useState<Placement[]>([])
  const [preference, setPreference] = useState<Preference>(),
    [view, setView] = useState('list'),
    [group, setGroup] = useState('section'),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [mine, setMine] = useState(false),
    [subtasks, setSubtasks] = useState(false)
  const [sort, setSort] = useState('-updatedAt'),
    [limit, setLimit] = useState(50),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [settings, setSettings] = useState(false)
  const [sectionName, setSectionName] = useState(''),
    [anchor, setAnchor] = useState(localTaskDay()),
    [calendarMode, setCalendarMode] = useState('month'),
    [refresh, setRefresh] = useState(0)
  const canEdit =
    board && ['owner', 'editor'].includes(board.workspaceRole ?? '') && !board.archived
  const syncURL = (next: Record<string, string>) => {
    const url = new URL(location.href)
    for (const [key, value] of Object.entries(next)) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    history.replaceState(null, '', url)
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setSearch(params.get('boardSearch') ?? '')
    setStatus(params.get('boardStatus') ?? '')
    setGroup(params.get('group') === 'status' ? 'status' : 'section')
    setSubtasks(params.get('subtasks') === 'true')
    setMine(params.get('mine') === 'true')
    setSort(
      ['-updatedAt', 'title', 'dueDate', 'position'].includes(params.get('boardSort') ?? '')
        ? params.get('boardSort')!
        : '-updatedAt',
    )
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('calendarDate') ?? ''))
      setAnchor(params.get('calendarDate')!)
    setCalendarMode(params.get('calendarRange') === 'week' ? 'week' : 'month')
    void reviewAPI<Page<Preference>>(
      api,
      `task-board-preferences?${query({ board: { equals: id } })}`,
    )
      .then((r) => {
        setPreference(r.docs[0])
        const requested = params.get('view') ?? r.docs[0]?.view ?? 'list'
        setView(['list', 'board', 'calendar'].includes(requested) ? requested : 'list')
      })
      .catch((e) => setError(e.message))
  }, [api, id])
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [b, s, t] = await Promise.all([
        reviewAPI<Board>(api, `task-boards/${id}?depth=0`),
        reviewAll<Section>(
          api,
          'task-sections',
          { and: [{ board: { equals: id } }, { archived: { not_equals: true } }] },
          'position',
        ),
        reviewAPI<Page<Task>>(
          api,
          `review-tasks?${query(
            {
              and: [
                { boards: { equals: id } },
                { archived: { not_equals: true } },
                ...(!subtasks || view === 'board' ? [{ parent: { exists: false } }] : []),
                ...taskSearchTerms(search).map((term) => ({ title: { contains: term } })),
                ...(status ? [{ status: { equals: status } }] : []),
                ...(mine ? [{ assignee: { equals: user?.id } }] : []),
              ],
            },
            { limit: String(limit), sort: sort === 'position' ? 'createdAt' : sort },
          )}`,
        ),
      ])
      setBoard(b)
      setSections(s)
      setTasks(t.docs)
      setTotal(t.totalDocs)
      const roots = [...new Set(t.docs.map((task) => task.parent ?? task.id))]
      const placements: Placement[] = []
      for (let offset = 0; offset < roots.length; offset += 30)
        placements.push(
          ...(await reviewAll<Placement>(
            api,
            'task-placements',
            {
              and: [
                { board: { equals: id } },
                { active: { equals: true } },
                { task: { in: roots.slice(offset, offset + 30) } },
              ],
            },
            'position',
          )),
        )
      setPlacements(placements)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, id, search, status, subtasks, view, mine, user, limit, sort])
  useEffect(() => {
    void load()
  }, [load, refreshKey, refresh])
  useEffect(() => {
    const reload = (): void => {
      void load()
    }
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [load])
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
  const move = (task: Task, target: string, position = 0) =>
    run(async () => {
      if (group === 'status')
        return reviewAPI(api, `review-tasks/${task.id}`, 'PATCH', {
          status: target,
          expectedUpdatedAt: task.updatedAt,
        })
      const placement = placements.find((p) => p.task === task.id)
      if (!placement) throw new Error('Reload this board before moving the task.')
      return reviewAPI(api, `review-tasks/${task.id}/workspace`, 'POST', {
        action: 'move',
        board: Number(id),
        section: target ? Number(target) : null,
        position,
        expectedUpdatedAt: placement.updatedAt,
      })
    })
  const groups =
    group === 'status'
      ? Object.entries(statuses).map(([key, name]) => ({ key, name }))
      : [
          { key: '', name: 'Unsectioned' },
          ...sections.map((s) => ({ key: String(s.id), name: s.name })),
        ]
  const taskGroup = (task: Task) =>
    group === 'status'
      ? task.status
      : String(placements.find((p) => p.task === (task.parent ?? task.id))?.section ?? '')
  const taskPosition = (task: Task) => placements.find((p) => p.task === task.id)?.position ?? 0
  const adjacentPosition = (task: Task, direction: number) => {
    const siblings = tasks
      .filter((t) => !t.parent && taskGroup(t) === taskGroup(task))
      .sort((a, b) => taskPosition(a) - taskPosition(b) || a.id - b.id)
    const index = siblings.findIndex((t) => t.id === task.id)
    const neighbor = siblings[index + direction]
    if (!neighbor) return null
    const outer = siblings[index + direction * 2]
    return outer
      ? (taskPosition(neighbor) + taskPosition(outer)) / 2
      : taskPosition(neighbor) + direction
  }
  const card = (task: Task) => (
    <article
      className="task-board-card"
      key={task.id}
      draggable={!!canEdit && !task.parent && !busy}
      onDragStart={(e) => e.dataTransfer.setData('text/task-id', String(task.id))}
    >
      <button className="task-title" type="button" onClick={() => onSelect(task)}>
        {task.title}
      </button>
      {task.parent && <small>Subtask of #{task.parent}</small>}
      <span className={`task-status task-status--${task.status}`}>
        {statuses[task.status as keyof typeof statuses]}
      </span>
      <small>
        {task.assigneeLabel ??
          (task.assignee ? `Assigned to user #${task.assignee}` : 'Unassigned')}
        {task.dueDate ? ` · Due ${task.dueDate.slice(0, 10)}` : ''}
      </small>
      {!task.parent && <SubtaskProgress api={api} task={task} onSelect={onSelect} />}
      {canEdit && !task.parent && view !== 'calendar' && (
        <label>
          Move to
          <select
            aria-label={`Move ${task.title} to`}
            value={taskGroup(task)}
            disabled={busy}
            onChange={(e) => void move(task, e.target.value)}
          >
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {canEdit && !task.parent && view !== 'calendar' && group === 'section' && (
        <div className="task-order-controls">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const position = adjacentPosition(task, -1)
              if (position !== null) {
                setSort('position')
                syncURL({ boardSort: 'position' })
                void move(task, taskGroup(task), position)
              }
            }}
            aria-label={`Move ${task.title} earlier`}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const position = adjacentPosition(task, 1)
              if (position !== null) {
                setSort('position')
                syncURL({ boardSort: 'position' })
                void move(task, taskGroup(task), position)
              }
            }}
            aria-label={`Move ${task.title} later`}
          >
            ↓
          </button>
        </div>
      )}
    </article>
  )
  let days: string[] = []
  if (view === 'calendar') {
    const date = new Date(`${anchor}T12:00:00Z`)
    if (calendarMode === 'month') date.setUTCDate(1)
    date.setUTCDate(date.getUTCDate() - date.getUTCDay())
    const first = date.toISOString().slice(0, 10)
    days = Array.from({ length: calendarMode === 'week' ? 7 : 42 }, (_, i) => nextTaskDay(first, i))
  }
  return (
    <section>
      <Link href={viewURL(admin)}>← All boards</Link>
      <header className="task-workspace-heading">
        <div>
          <h2>{board?.name ?? 'Board'}</h2>
          <p>{board?.description}</p>
          <small>
            {board?.visibility === 'team' ? 'Team-wide' : 'Private'} · {board?.workspaceRole}
            {board?.archived ? ' · Archived' : ''}
          </small>
        </div>
        {board?.workspaceRole === 'owner' && (
          <button type="button" onClick={() => setSettings(true)}>
            Board settings
          </button>
        )}
        {canEdit && (
          <button type="button" className="task-primary" onClick={onCreate}>
            Add task
          </button>
        )}
      </header>
      <div className="task-workspace-toolbar">
        <div role="group" aria-label="Board view">
          {['list', 'board', 'calendar'].map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                setView(v)
                syncURL({ view: v })
                void reviewAPI<{ doc: Preference }>(
                  api,
                  `task-board-preferences${preference ? `/${preference.id}` : ''}`,
                  preference ? 'PATCH' : 'POST',
                  { board: Number(id), view: v },
                )
                  .then((r) => setPreference(r.doc))
                  .catch((e) => setError(e.message))
              }}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              syncURL({ boardSearch: e.target.value })
              setLimit(50)
            }}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              syncURL({ boardStatus: e.target.value })
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(statuses).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Group by
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value)
              syncURL({ group: e.target.value })
            }}
          >
            <option value="section">Sections</option>
            <option value="status">Status</option>
          </select>
        </label>
        <label>
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value)
              syncURL({ boardSort: e.target.value })
            }}
          >
            <option value="-updatedAt">Recently updated</option>
            <option value="position">Manual order</option>
            <option value="title">Title</option>
            <option value="dueDate">Due date</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked)
              syncURL({ mine: String(e.target.checked) })
            }}
          />{' '}
          Assigned to me
        </label>
        {view !== 'board' && (
          <label>
            <input
              type="checkbox"
              checked={subtasks}
              onChange={(e) => {
                setSubtasks(e.target.checked)
                syncURL({ subtasks: String(e.target.checked) })
              }}
            />{' '}
            Include subtasks
          </label>
        )}
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {canEdit && group === 'section' && (
        <details>
          <summary>Manage sections</summary>
          <div className="task-workspace-toolbar">
            <label>
              New section
              <input value={sectionName} onChange={(e) => setSectionName(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={busy || !sectionName.trim()}
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
              Add section
            </button>
          </div>
          {sections.map((s) => (
            <div className="task-workspace-toolbar" key={s.id}>
              <span>{s.name}</span>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt('Section name', s.name)
                  if (name?.trim())
                    void run(() => reviewAPI(api, `task-sections/${s.id}`, 'PATCH', { name }))
                }}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() =>
                  void run(() =>
                    reviewAPI(api, `task-sections/${s.id}`, 'PATCH', { archived: true }),
                  )
                }
              >
                Archive section
              </button>
            </div>
          ))}
        </details>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRefresh(refresh + 1)}>
            Retry
          </button>
        </p>
      )}
      {loading && <p role="status">Loading tasks…</p>}
      {!loading && !error && !tasks.length && <p>No tasks match this view.</p>}
      {view === 'calendar' ? (
        <>
          <div className="task-workspace-toolbar">
            <label>
              Calendar date
              <input
                type="date"
                value={anchor}
                onChange={(e) => {
                  if (e.target.value) {
                    setAnchor(e.target.value)
                    syncURL({ calendarDate: e.target.value })
                  }
                }}
              />
            </label>
            <label>
              Range
              <select
                value={calendarMode}
                onChange={(e) => {
                  setCalendarMode(e.target.value)
                  syncURL({ calendarRange: e.target.value })
                }}
              >
                <option value="month">Month</option>
                <option value="week">Week</option>
              </select>
            </label>
            <span>
              Deadlines are calendar dates; rescheduling keeps the same date across timezones.
            </span>
          </div>
          <div className="task-calendar-scroll">
            <div className="task-calendar">
              {days.map((day) => (
                <section key={day} aria-label={day}>
                  <h3>
                    {new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </h3>
                  {tasks
                    .filter((task) => task.dueDate?.slice(0, 10) === day)
                    .map((task) => (
                      <div key={task.id}>
                        {card(task)}
                        {canEdit && (
                          <label>
                            Reschedule
                            <input
                              type="date"
                              value={task.dueDate!.slice(0, 10)}
                              disabled={busy}
                              onChange={(e) =>
                                void run(() =>
                                  reviewAPI(api, `review-tasks/${task.id}`, 'PATCH', {
                                    dueDate: e.target.value
                                      ? `${e.target.value}T12:00:00.000Z`
                                      : null,
                                    expectedUpdatedAt: task.updatedAt,
                                  }),
                                )
                              }
                            />
                          </label>
                        )}
                      </div>
                    ))}
                </section>
              ))}
            </div>
          </div>
          <h3>No due date</h3>
          <div className="task-undated">
            {tasks
              .filter((task) => !task.dueDate)
              .map((task) => (
                <div key={task.id}>
                  {card(task)}
                  {canEdit && (
                    <label>
                      Schedule
                      <input
                        type="date"
                        onChange={(e) => {
                          if (e.target.value)
                            void run(() =>
                              reviewAPI(api, `review-tasks/${task.id}`, 'PATCH', {
                                dueDate: `${e.target.value}T12:00:00.000Z`,
                                expectedUpdatedAt: task.updatedAt,
                              }),
                            )
                        }}
                      />
                    </label>
                  )}
                </div>
              ))}
          </div>
        </>
      ) : (
        <div className={view === 'board' ? 'task-kanban' : 'task-board-list'}>
          {groups.map((g) => (
            <section
              key={g.key}
              onDragOver={(e) => {
                if (canEdit) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                const task = tasks.find(
                  (t) => String(t.id) === e.dataTransfer.getData('text/task-id'),
                )
                if (task && canEdit)
                  void move(task, g.key, Math.max(0, ...placements.map((p) => p.position)) + 1)
              }}
            >
              <h3>
                {g.name} <small>{tasks.filter((task) => taskGroup(task) === g.key).length}</small>
              </h3>
              {tasks
                .filter(
                  (task) =>
                    taskGroup(task) === g.key ||
                    (g.key === '' && !groups.some((group) => group.key === taskGroup(task))),
                )
                .sort((a, b) =>
                  group === 'section' && (view === 'board' || sort === 'position')
                    ? taskPosition(a) - taskPosition(b) || a.id - b.id
                    : 0,
                )
                .map(card)}
            </section>
          ))}
        </div>
      )}
      <p>
        {tasks.length} of {total} matching tasks
        {tasks.length < total ? ' — load more to include additional tasks in this view.' : ''}
      </p>
      {tasks.length < total && (
        <button type="button" disabled={loading} onClick={() => setLimit(limit + 50)}>
          Load more tasks
        </button>
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
    </section>
  )
}

function SubtaskProgress({
  api,
  task,
  onSelect,
}: {
  api: string
  task: Task
  onSelect: (task: Task) => void
}) {
  const [children, setChildren] = useState<Task[]>([])
  useEffect(() => {
    let current = true
    void reviewAll<Task>(api, 'review-tasks', { parent: { equals: task.id } })
      .then((r) => {
        if (current) setChildren(r)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [api, task])
  if (!children.length) return null
  return (
    <details>
      <summary>
        {children.filter((c) => c.status === 'done').length}/{children.length} subtasks complete
      </summary>
      <ul>
        {children.map((child) => (
          <li key={child.id}>
            <button type="button" onClick={() => onSelect(child)}>
              {child.title}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
