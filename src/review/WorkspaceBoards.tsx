'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize board routes and remote records. */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@payloadcms/ui'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { query, reviewAll, reviewAPI, taskSearchTerms, type Task } from './client'
import { ExpandedBoard } from './ExpandedBoard'

export type Board = {
  presentation?: { priorityColors?: Record<string,string> }
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
  onCreate: (parent?: Task, section?: number) => void
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
      <ExpandedBoard
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

export function BoardSettings({
  api,
  board,
  onClose,
  onSaved,
  initialProject,
}: {
  api: string
  board?: Board
  onClose: () => void
  onSaved: () => void
  initialProject?: number
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
                    ...(!board && initialProject
                      ? { project: initialProject, inheritProject: true }
                      : {}),
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
