'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize remote project navigation, settings, and paginated directories. */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Home, Inbox, CheckSquare, ChevronRight, ChevronDown, Plus } from './WorkspaceIcon'
import { BoardIcon } from './BoardIcon'
import { InboxBadge } from './WorkspaceInbox'
import { useRouter, useSearchParams } from 'next/navigation'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { query, reviewAll, reviewAPI } from './client'
import { BoardSettings } from './WorkspaceBoards'
import { boardFilter, type ProjectBoardSummary } from './project-board-model'
import { ReferencePicker } from './WorkspaceTaskDetails'

export type Project = {
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
const base = (admin: string) => `${admin}/collections/review-tasks`
export function ProjectNavigator({ api, admin }: { api: string; admin: string }) {
  const params = useSearchParams()
  const [addingBoard, setAddingBoard] = useState<Project | null>(null)
  const [savingPreference, setSavingPreference] = useState<number | null>(null)
  const [projects, setProjects] = useState<Project[]>([]),
    [boards, setBoards] = useState<any[]>([]),
    [prefs, setPrefs] = useState<any[]>([]),
    [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const [p, b, f] = await Promise.all([
        reviewAll<Project>(api, 'task-projects', { archived: { not_equals: true } }, 'name'),
        reviewAll<any>(api, 'task-boards', { archived: { not_equals: true } }, 'name'),
        reviewAll<any>(api, 'task-project-preferences', {}),
      ])
      setProjects(p)
      setBoards(b)
      setPrefs(f)
      setError('')
    } catch (e) {
      setError((e as Error).message)
      if ([403, 404].includes((e as { status?: number }).status ?? 0)) {
        setProjects([])
        setBoards([])
        setPrefs([])
      }
    }
  }, [api])
  useEffect(() => {
    void load()
    window.addEventListener('vorti-tasks-changed', load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener('vorti-tasks-changed', load)
      window.removeEventListener('focus', load)
    }
  }, [load])
  return (
    <>
      <aside className="workspace-project-tree" aria-label="Projects and boards">
        <nav className="workspace-local-menu" aria-label="Workspace menu">
          <Link
            href={`${base(admin)}?workspace=home`}
            aria-current={params.get('workspace') === 'home' ? 'page' : undefined}
          >
            <Home size={17} aria-hidden="true" />
            Home
          </Link>
          <Link
            href={`${base(admin)}?workspace=inbox`}
            aria-current={params.get('workspace') === 'inbox' ? 'page' : undefined}
          >
            <Inbox size={17} aria-hidden="true" />
            Inbox <InboxBadge api={api} />
          </Link>
          <Link
            href={`${base(admin)}?taskView=assigned`}
            aria-current={
              params.get('taskView') === 'assigned' && !params.get('workspace') ? 'page' : undefined
            }
          >
            <CheckSquare size={17} aria-hidden="true" />
            My Tasks
          </Link>
        </nav>
        {error && (
          <button type="button" onClick={() => void load()}>
            Reload projects
          </button>
        )}
        {[...projects]
          .sort(
            (a, b) =>
              Number(b.name === 'Work') - Number(a.name === 'Work') ||
              a.name.localeCompare(b.name) ||
              a.id - b.id,
          )
          .map((project) => {
            const preference = prefs.find((pref) => pref.project === project.id)
            return (
              <div className="workspace-project-group" key={project.id}>
                <div className="workspace-project-row">
                  <button
                    type="button"
                    className="workspace-project-caret"
                    aria-label={`${preference?.expanded === false ? 'Expand' : 'Collapse'} ${project.name}`}
                    aria-expanded={preference?.expanded !== false}
                    aria-controls={`workspace-project-${project.id}`}
                    disabled={savingPreference === project.id}
                    onClick={() => {
                      setSavingPreference(project.id)
                      void reviewAPI(
                        api,
                        `task-project-preferences${preference ? `/${preference.id}` : ''}`,
                        preference ? 'PATCH' : 'POST',
                        { project: project.id, expanded: preference?.expanded === false },
                      )
                        .then(load)
                        .catch((e) => setError(e.message))
                        .finally(() => setSavingPreference(null))
                    }}
                  >
                    <span aria-hidden="true">
                      {preference?.expanded === false ? (
                        <ChevronRight size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </span>
                  </button>
                  <Link
                    href={`${base(admin)}?workspace=projects&project=${project.id}`}
                    aria-current={params.get('project') === String(project.id) ? 'page' : undefined}
                  >
                    {project.name}
                  </Link>
                  {['owner', 'editor'].includes(project.workspaceRole || '') &&
                    !project.archived && (
                      <button
                        type="button"
                        className="workspace-project-add"
                        aria-label={`Add board to ${project.name}`}
                        title={`Add board to ${project.name}`}
                        onClick={() => setAddingBoard(project)}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    )}
                </div>
                <div
                  id={`workspace-project-${project.id}`}
                  className="workspace-project-boards"
                  hidden={preference?.expanded === false}
                >
                  {boards
                    .filter((board) => board.project === project.id)
                    .map((board) => (
                      <div className="workspace-board-nav-row" key={board.id}>
                        <BoardIcon api={api} board={board.id} name={board.name} />
                        <Link
                          href={`${base(admin)}?workspace=boards&board=${board.id}`}
                          aria-current={
                            params.get('board') === String(board.id) ? 'page' : undefined
                          }
                        >
                          {board.name}
                        </Link>
                      </div>
                    ))}
                </div>
              </div>
            )
          })}
        {error && <p role="alert">{error}</p>}
      </aside>
      {addingBoard && (
        <BoardSettings
          api={api}
          initialProject={addingBoard.id}
          onClose={() => setAddingBoard(null)}
          onSaved={() => {
            const target = addingBoard
            setAddingBoard(null)
            const pref = prefs.find((item) => item.project === target.id)
            void reviewAPI(
              api,
              `task-project-preferences${pref ? `/${pref.id}` : ''}`,
              pref ? 'PATCH' : 'POST',
              { project: target.id, expanded: true },
            )
              .catch((e) => setError(e.message))
              .finally(() => {
                void load()
                window.dispatchEvent(new Event('vorti-tasks-changed'))
              })
          }}
        />
      )}
    </>
  )
}
export function WorkspaceProjects({
  api,
  admin,
  projectID,
}: {
  api: string
  admin: string
  projectID?: string
}) {
  const params = useSearchParams()
  const router = useRouter()
  const filter = boardFilter(params.get('boardFilter'))
  const [projects, setProjects] = useState<Project[]>([]),
    [boards, setBoards] = useState<ProjectBoardSummary[]>([]),
    [counts, setCounts] = useState<Record<string, { boards: number; tasks: number }>>({}),
    [prefs, setPrefs] = useState<any[]>([]),
    [search, setSearch] = useState(''),
    [archived, setArchived] = useState(false),
    [favorites, setFavorites] = useState(false),
    [settings, setSettings] = useState<Project | null | false>(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [requests, setRequests] = useState<any[]>([])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await reviewAPI<any>(
        api,
        projectID
          ? `task-projects?${query({ id: { equals: projectID } })}`
          : `task-workspace/projects?${new URLSearchParams({ search, page: String(page), archived: String(archived), favorites: String(favorites) })}`,
      )
      setProjects(result.docs)
      setPages(result.totalPages)
      const preferences = await reviewAll<any>(api, 'task-project-preferences', {})
      setPrefs(preferences)
      const totals: Record<string, { boards: number; tasks: number }> = {}
      for (const project of projectID ? [] : result.docs) {
        const count = await reviewAPI<any>(api, `task-workspace/projects/${project.id}/counts`)
        totals[project.id] = count
      }
      setCounts(totals)
      if (projectID)
        setBoards(
          (
            await reviewAPI<{ docs: ProjectBoardSummary[] }>(
              api,
              `task-workspace/projects/${projectID}/boards`,
            )
          ).docs,
        )
      setRequests(await reviewAll(api, 'task-project-changes', { state: { equals: 'pending' } }))
      setError('')
    } catch (e) {
      setError((e as Error).message)
      if ([403, 404].includes((e as { status?: number }).status ?? 0)) {
        setProjects([])
        setBoards([])
        setCounts({})
        setRequests([])
      }
    } finally {
      setLoading(false)
    }
  }, [api, projectID, search, archived, page, favorites])
  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    window.addEventListener('vorti-tasks-changed', load)
    return () => {
      window.removeEventListener('focus', load)
      window.removeEventListener('vorti-tasks-changed', load)
    }
  }, [load])
  const project = projectID ? projects[0] : undefined
  return (
    <section className="workspace-projects">
      <header className="task-workspace-heading">
        <div>
          <p>{project ? 'Project' : 'Your workspace'}</p>
          <h2>{project?.name ?? 'Projects'}</h2>
          <p>{project?.description ?? 'Keep boards together, with room for private work.'}</p>
        </div>
        <div>
          {project && (
            <label className="project-board-filter">
              Show boards
              <select
                aria-label="Show boards"
                value={filter}
                onChange={(event) => {
                  const next = new URLSearchParams(params.toString())
                  if (event.target.value === 'all') next.delete('boardFilter')
                  else next.set('boardFilter', event.target.value)
                  router.push(`${base(admin)}?${next}`, { scroll: false })
                }}
              >
                <option value="all">All boards</option>
                <option value="overdue">Has overdue tasks</option>
                <option value="upcoming">Has upcoming tasks</option>
                <option value="completed">Has completed tasks</option>
              </select>
            </label>
          )}
          {project?.workspaceRole === 'owner' && (
            <button type="button" onClick={() => setSettings(project)}>
              Project settings
            </button>
          )}
        </div>
      </header>
      {!projectID && (
        <div className="task-workspace-toolbar">
          <label>
            Find a project
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
              onChange={(e) => setFavorites(e.target.checked)}
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
            Archived projects
          </label>
        </div>
      )}
      {loading && <p role="status">Loading projects…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      <div className="task-board-directory">
        {projectID
          ? !loading &&
            !error &&
            boards
              .filter((board) => filter === 'all' || board.counts[filter] > 0)
              .map((board) => (
                <Link
                  className="project-board-tile"
                  key={board.id}
                  href={`${base(admin)}?workspace=boards&board=${board.id}${params.get('site') ? `&site=${encodeURIComponent(params.get('site')!)}` : ''}`}
                >
                  <small>{board.inheritProject ? 'Project access' : 'Private board'}</small>
                  <h3>{board.name}</h3>
                  {board.description && <p>{board.description}</p>}
                  <dl className="project-board-stats">
                    {(
                      [
                        ['overdue', 'Tasks Overdue'],
                        ['upcoming', 'Tasks Upcoming'],
                        ['completed', 'Tasks Completed'],
                        ['all', 'All Tasks'],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{board.counts[key]}</dd>
                      </div>
                    ))}
                  </dl>
                  <span className="project-board-open">Open board →</span>
                </Link>
              ))
          : projects
              .filter(
                (project) =>
                  !favorites || prefs.some((pref) => pref.project === project.id && pref.favorite),
              )
              .map((project) => {
                const pref = prefs.find((item) => item.project === project.id)
                return (
                  <article key={project.id}>
                    <header className="task-workspace-heading">
                      <small>
                        {project.visibility === 'team' ? 'Team-wide' : 'Private'} ·{' '}
                        {project.workspaceRole}
                      </small>
                      <button
                        type="button"
                        aria-label={`${pref?.favorite ? 'Unfavorite' : 'Favorite'} ${project.name}`}
                        onClick={() =>
                          void reviewAPI(
                            api,
                            `task-project-preferences${pref ? `/${pref.id}` : ''}`,
                            pref ? 'PATCH' : 'POST',
                            { project: project.id, favorite: !pref?.favorite },
                          )
                            .then(load)
                            .catch((e) => setError(e.message))
                        }
                      >
                        {pref?.favorite ? '★' : '☆'}
                      </button>
                    </header>
                    <h3>
                      <Link href={`${base(admin)}?workspace=projects&project=${project.id}`}>
                        {project.name}
                      </Link>
                    </h3>
                    <p>{project.description}</p>
                    <strong>
                      {counts[project.id]?.boards ?? '…'} accessible boards ·{' '}
                      {counts[project.id]?.tasks ?? '…'} unfinished tasks
                    </strong>
                    <small>Owned by {project.ownerLabel ?? `User #${project.owner}`}</small>
                  </article>
                )
              })}
      </div>
      {!loading && !error && !(projectID ? boards : projects).length && (
        <p>No {projectID ? 'boards' : 'projects'} yet.</p>
      )}
      {projectID &&
        !loading &&
        !error &&
        boards.length > 0 &&
        filter !== 'all' &&
        !boards.some((board) => board.counts[filter] > 0) && <p>No boards match this filter.</p>}
      {!projectID && pages > 1 && (
        <nav aria-label="Project pages">
          <button type="button" disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
            Previous
          </button>
          <span>
            {page} / {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((v) => v + 1)}>
            Next
          </button>
        </nav>
      )}
      {requests.length > 0 && (
        <section>
          <h3>Sharing approvals</h3>
          {requests.map((request) => (
            <article key={request.id}>
              <p>
                Audience change #{request.id}. Approval includes tasks, discussion, files, and
                subtasks.
              </p>
              <button
                type="button"
                onClick={() =>
                  void reviewAPI(api, 'task-workspace/project-sharing', 'POST', {
                    action: 'approve',
                    request: request.id,
                  })
                    .then(load)
                    .catch((e) => setError(e.message))
                }
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() =>
                  void reviewAPI(api, 'task-workspace/project-sharing', 'POST', {
                    action: 'reject',
                    request: request.id,
                  })
                    .then(load)
                    .catch((e) => setError(e.message))
                }
              >
                Reject
              </button>
            </article>
          ))}
        </section>
      )}
      {settings !== false && (
        <ProjectSettings
          api={api}
          project={settings ?? undefined}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false)
            void load()
            window.dispatchEvent(new Event('vorti-tasks-changed'))
          }}
        />
      )}
    </section>
  )
}
export function ProjectSettings({
  api,
  project,
  onClose,
  onSaved,
}: {
  api: string
  project?: Project
  onClose: () => void
  onSaved: (project: Project) => void
}) {
  const [name, setName] = useState(project?.name ?? ''),
    [description, setDescription] = useState(project?.description ?? ''),
    [visibility, setVisibility] = useState(project?.visibility ?? 'private'),
    [archived, setArchived] = useState(!!project?.archived),
    [owner, setOwner] = useState<any[]>(project ? [project.owner] : []),
    [members, setMembers] = useState<any[]>([]),
    [people, setPeople] = useState<any[]>([]),
    [role, setRole] = useState('viewer'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (project)
      setMembers(
        await reviewAll(api, 'task-project-memberships', { project: { equals: project.id } }),
      )
  }, [api, project])
  useEffect(() => {
    void load().catch((e) => setError(e.message))
  }, [load])
  const dirty =
    name !== (project?.name ?? '') ||
    description !== (project?.description ?? '') ||
    visibility !== (project?.visibility ?? 'private') ||
    archived !== !!project?.archived
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      setError('')
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <EditorDialog
      open
      title={project ? 'Project settings' : 'Create project'}
      onClose={() => {
        if (!dirty || confirm('Discard unsaved project changes?')) onClose()
      }}
    >
      <div className="workspace-settings">
        <p>
          Private boards keep separate membership. Administrators retain oversight and recovery
          access.
        </p>
        {error && <p role="alert">{error}</p>}
        <label>
          Name
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Visibility
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'private' | 'team')}
          >
            <option value="private">Private members</option>
            <option value="team">Team-wide · viewers by default</option>
          </select>
        </label>
        {project && (
          <>
            <label>
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />{' '}
              Archive project and make its boards read-only
            </label>
            <label>
              Transfer ownership
              <ReferencePicker
                api={api}
                people
                value={owner}
                onChange={(value) => setOwner(value.slice(-1))}
              />
            </label>
          </>
        )}
        <button
          type="button"
          className="task-primary"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              const saved = await reviewAPI<{ doc: Project }>(
                api,
                `task-projects${project ? `/${project.id}` : ''}`,
                project ? 'PATCH' : 'POST',
                {
                  name: name.trim(),
                  description,
                  visibility,
                  archived,
                  ...(project ? { owner: owner[0], expectedUpdatedAt: project.updatedAt } : {}),
                },
              )
              onSaved(saved.doc)
            })
          }
        >
          Save project
        </button>
        {project && (
          <>
            <h3>Members</h3>
            {members.map((member) => (
              <div className="task-workspace-toolbar" key={member.id}>
                <span>{member.userLabel ?? `User #${member.user}`}</span>
                <select
                  value={member.role}
                  disabled={busy}
                  onChange={(e) =>
                    void run(async () => {
                      await reviewAPI(api, `task-project-memberships/${member.id}`, 'PATCH', {
                        role: e.target.value,
                        expectedUpdatedAt: member.updatedAt,
                      })
                      await load()
                    })
                  }
                >
                  {['editor', 'commenter', 'viewer'].map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await reviewAPI(api, `task-project-memberships/${member.id}`, 'DELETE')
                      await load()
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <ReferencePicker api={api} people value={people} onChange={setPeople} />
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {['editor', 'commenter', 'viewer'].map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !people.length}
              onClick={() =>
                void run(async () => {
                  for (const user of people)
                    await reviewAPI(api, 'task-project-memberships', 'POST', {
                      project: project.id,
                      user,
                      role,
                    })
                  setPeople([])
                  await load()
                })
              }
            >
              Add members
            </button>
          </>
        )}
      </div>
    </EditorDialog>
  )
}
