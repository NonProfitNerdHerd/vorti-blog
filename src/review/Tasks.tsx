'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize remote review records and reset pagination when filters change. */
import { useAuth, useConfig } from '@payloadcms/ui'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { query, reviewAPI, reviewAll, statuses, taskSearchTerms, type Task } from './client'
import { TaskDashboard } from './TaskDashboard'
import { taskDocumentLink } from './links'
import { MentionInput } from './MentionInput'
import type { Mention } from './mentions'
import { TaskCollaboration } from './TaskCollaboration'
import { WorkspaceBoards } from './WorkspaceBoards'
import { WorkspaceInbox } from './WorkspaceInbox'
import { useSearchParams } from 'next/navigation'
import './workspace.css'

type Person = { id: number; label: string }
type Context = { type: string; id: string }
type Page<T> = { docs: T[]; totalPages: number; totalDocs: number }
type Comment = {
  id: number
  author?: number
  body: string
  createdAt: string
  updatedAt: string
  moderated?: boolean
  mentions?: Mention[]
  mentionLabels?: (Mention & { username: string })[]
  authorLabel?: string
}
type Activity = {
  id: number
  actor?: number
  actorLabel?: string
  message: string
  createdAt: string
}

function SafeText({
  text,
  mentions = [],
}: {
  text: string
  mentions?: (Mention & { username: string })[]
}) {
  for (const mention of [...mentions].sort((a, b) => b.start - a.start))
    text = text.slice(0, mention.start) + `@${mention.username}` + text.slice(mention.end)
  return (
    <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {text.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </span>
  )
}

export function Tasks({
  document: owner,
  onChange,
  renderList,
}: {
  document?: Context
  onChange?: () => Promise<void>
  renderList?: (props: { onSelect: (task: Task) => void; refreshKey: number }) => ReactNode
}) {
  const {
    config: {
      routes: { api, admin },
    },
  } = useConfig()
  const { user } = useAuth()
  const params = useSearchParams()
  const workspace = params.get('workspace')
  const boardID = workspace === 'boards' ? (params.get('board') ?? undefined) : undefined
  const router = useRouter()
  const ownerType = owner?.type,
    ownerID = owner?.id
  const listRequest = useRef(0)
  const [dashboardVersion, setDashboardVersion] = useState(0)
  const [tasks, setTasks] = useState<Task[]>([]),
    [people, setPeople] = useState<Person[]>([])
  const [selected, setSelected] = useState<Task | null>(null),
    [creating, setCreating] = useState(false)
  const [parent, setParent] = useState<Task | null>(null)
  const selectTask = (task: Task) => {
    void reviewAPI<Task>(api, `review-tasks/${task.id}?depth=0`)
      .then(setSelected)
      .catch((e) => setError(e.message))
  }
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('active')
  const [assignee, setAssignee] = useState(''),
    [creator, setCreator] = useState(''),
    [priority, setPriority] = useState(''),
    [type, setType] = useState('')
  const [due, setDue] = useState(''),
    [archived, setArchived] = useState(false),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1)
  const refresh = useCallback(async () => {
    if (!ownerType || !ownerID) return
    const requestID = ++listRequest.current
    const and: object[] = [{ archived: { equals: archived } }]
    if (ownerType && ownerID)
      and.push({ documentType: { equals: ownerType } }, { documentID: { equals: ownerID } })
    for (const term of taskSearchTerms(search)) and.push({ title: { contains: term } })
    if (status)
      and.push({ status: status === 'active' ? { not_equals: 'done' } : { equals: status } })
    if (assignee) and.push({ assignee: { equals: assignee } })
    if (creator) and.push({ creator: { equals: creator } })
    if (priority) and.push({ priority: { equals: priority } })
    if (type) and.push({ documentType: { equals: type } })
    if (due) and.push({ dueDate: { less_than_equal: `${due}T23:59:59.999Z` } })
    const data = await reviewAPI<Page<Task>>(
      api,
      `review-tasks?${query({ and }, { page: String(page) })}`,
    )
    if (requestID === listRequest.current) {
      setTasks(data.docs)
      setPages(data.totalPages)
    }
  }, [
    api,
    ownerType,
    ownerID,
    search,
    status,
    assignee,
    creator,
    priority,
    type,
    due,
    archived,
    page,
  ])
  useEffect(() => {
    void refresh().catch((e) => setError(e.message))
  }, [refresh])
  useEffect(() => {
    setPage(1)
  }, [search, status, assignee, creator, priority, type, due, archived])
  useEffect(() => {
    const params = selected?.id
      ? new URLSearchParams({ taskID: String(selected.id) })
      : boardID
        ? new URLSearchParams({ board: boardID })
        : ownerType && ownerID
          ? new URLSearchParams({ documentType: ownerType, documentID: ownerID })
          : ''
    const loadPeople = (): void =>
      void reviewAPI<{ docs: Person[] }>(api, `review-tasks/assignees?${params}`)
        .then((data) => setPeople(data.docs))
        .catch((e) => setError(e.message))
    loadPeople()
    window.addEventListener('focus', loadPeople)
    window.addEventListener('vorti-user-identity-saved', loadPeople)
    const id = new URLSearchParams(location.search).get('task')
    if (id && !selected?.id && !creating)
      void reviewAPI<Task>(api, `review-tasks/${encodeURIComponent(id)}?depth=0`)
        .then((task) => {
          if (!ownerType || (task.documentType === ownerType && task.documentID === ownerID))
            setSelected(task)
        })
        .catch((e) => setError(e.message))
    return () => {
      window.removeEventListener('focus', loadPeople)
      window.removeEventListener('vorti-user-identity-saved', loadPeople)
    }
  }, [api, ownerType, ownerID, selected?.id, creating, boardID])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
      await onChange?.()
      setDashboardVersion((value) => value + 1)
      window.dispatchEvent(new Event('vorti-tasks-changed'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const person = (id?: number) =>
    people.find((p) => p.id === id)?.label || (id ? `User ${id}` : 'Unassigned')
  const openDocument = async (task: Task) => {
    const result = await reviewAPI<{ available: boolean }>(api, `review-tasks/${task.id}/document`)
    if (!result.available)
      throw new Error('Document unavailable. Its review history is retained here.')
    router.push(taskDocumentLink(task, admin))
  }
  return (
    <div
      className="review-tasks"
      onKeyDown={(event) => {
        // Review inputs must never implicitly submit the surrounding document form.
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
          event.preventDefault()
      }}
    >
      {error && !selected && !creating && <p role="alert">{error}</p>}
      {selected || creating ? (
        <EditorDialog
          open
          title={selected ? 'Task details' : parent ? `Subtask of ${parent.title}` : 'New task'}
          onClose={() => {
            if (busy) return
            const url = new URL(location.href)
            url.searchParams.delete('task')
            url.searchParams.delete('comment')
            history.replaceState(null, '', url)
            setSelected(null)
            setCreating(false)
            setParent(null)
            setError('')
          }}
        >
          <div className="review-tasks review-task-dialog">
            {error && <p role="alert">{error}</p>}
            <TaskEditor
              key={selected?.id ?? `new-${parent?.id ?? ''}`}
              task={selected}
              parent={parent}
              owner={owner}
              people={people}
              busy={busy}
              api={api}
              boardID={boardID}
              save={(data) =>
                run(async () => {
                  const result = await reviewAPI<{ doc: Task }>(
                    api,
                    `review-tasks${selected ? `/${selected.id}` : ''}`,
                    selected ? 'PATCH' : 'POST',
                    data,
                  )
                  setSelected(result.doc)
                  setCreating(false)
                  setParent(null)
                })
              }
            />
            {selected && (
              <>
                <p>
                  {selected.documentDeleted ? (
                    'Linked document is no longer available.'
                  ) : selected.documentRestricted ? (
                    'Linked document is restricted.'
                  ) : selected.documentType ? (
                    <>
                      {selected.documentTitle || selected.documentID} · {selected.documentType}
                      {selected.region && selected.region !== 'document'
                        ? ` · ${selected.region}`
                        : ''}
                    </>
                  ) : selected.personal ? (
                    'Personal task'
                  ) : (
                    'Board task'
                  )}
                </p>
                {!owner && selected.documentType && selected.documentID && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => openDocument(selected))}
                  >
                    Open document
                  </button>
                )}
                {selected.parent && (
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () =>
                        setSelected(
                          await reviewAPI<Task>(api, `review-tasks/${selected.parent}?depth=0`),
                        ),
                      )
                    }
                  >
                    Open parent task
                  </button>
                )}
                {!selected.parent && (
                  <Subtasks
                    api={api}
                    task={selected}
                    select={setSelected}
                    add={() => {
                      if (busy) return
                      setParent(selected)
                      setSelected(null)
                      setCreating(true)
                    }}
                  />
                )}
                {(user?.role === 'administrator' ||
                  (selected.canEdit && (!!selected.boards?.length || selected.personal))) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await reviewAPI<{ doc: Task }>(
                          api,
                          `review-tasks/${selected.id}`,
                          'PATCH',
                          { archived: !selected.archived },
                        )
                        setSelected(result.doc)
                      })
                    }
                  >
                    {selected.archived ? 'Restore task' : 'Archive task'}
                  </button>
                )}
                <TaskCollaboration
                  api={api}
                  task={selected}
                  onChange={async () => {
                    setSelected(await reviewAPI<Task>(api, `review-tasks/${selected.id}?depth=0`))
                    setDashboardVersion((value) => value + 1)
                    await onChange?.()
                  }}
                />
                <Discussion
                  key={selected.id}
                  api={api}
                  task={selected}
                  userID={user?.id}
                  admin={user?.role === 'administrator'}
                  person={person}
                  onChange={onChange}
                />
              </>
            )}
          </div>
        </EditorDialog>
      ) : null}
      {!owner && !renderList && workspace !== 'boards' && workspace !== 'inbox' && (
        <button
          className="task-primary"
          type="button"
          onClick={() => {
            setParent(null)
            setCreating(true)
          }}
        >
          Add task
        </button>
      )}
      {!owner && !renderList && workspace === 'boards' ? (
        <WorkspaceBoards
          api={api}
          admin={admin}
          boardID={boardID}
          onSelect={selectTask}
          onCreate={() => {
            setParent(null)
            setCreating(true)
          }}
          refreshKey={dashboardVersion}
        />
      ) : !owner && !renderList && workspace === 'inbox' ? (
        <WorkspaceInbox api={api} admin={admin} onSelect={selectTask} />
      ) : renderList ? (
        renderList({ onSelect: selectTask, refreshKey: dashboardVersion })
      ) : owner ? (
        <>
          {owner && (
            <button
              type="button"
              onClick={() => {
                setParent(null)
                setCreating(true)
              }}
            >
              Add task
            </button>
          )}
          <div className="review-shortcuts">
            <button
              type="button"
              onClick={() => {
                setAssignee(String(user?.id))
                setCreator('')
              }}
            >
              Assigned to me
            </button>
            <button
              type="button"
              onClick={() => {
                setCreator(String(user?.id))
                setAssignee('')
              }}
            >
              Created by me
            </button>
            <button
              type="button"
              onClick={() => {
                setAssignee('')
                setCreator('')
              }}
            >
              Everyone
            </button>
          </div>
          <label>
            Search tasks
            <input maxLength={120} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <details>
            <summary>Filters</summary>
            <div className="review-filters">
              <label>
                Status
                <select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="active">Unfinished</option>
                  <option value="">All statuses</option>
                  {Object.entries(statuses).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assignee
                <select
                  aria-label="Assignee"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Everyone</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Creator
                <select
                  aria-label="Creator"
                  value={creator}
                  onChange={(e) => setCreator(e.target.value)}
                >
                  <option value="">Everyone</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  aria-label="Priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="">All priorities</option>
                  {['low', 'normal', 'high', 'urgent'].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              {!owner && (
                <label>
                  Document type
                  <select
                    aria-label="Document type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="">All documents</option>
                    {['posts', 'pages', 'design-templates', 'site-templates'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Due on or before
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />{' '}
                Archived tasks
              </label>
            </div>
          </details>
          <ul className="review-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => selectTask(task)}>
                  {task.title}
                </button>
                <small>
                  {statuses[task.status as keyof typeof statuses]} · {person(task.assignee)}
                  {task.parent ? ` · Subtask of #${task.parent}` : ''}
                </small>
                {!owner && (
                  <small>
                    {task.documentTitle} · {task.documentType}
                  </small>
                )}
                {task.dueDate && <small>Due {task.dueDate.slice(0, 10)}</small>}
              </li>
            ))}
          </ul>
          {!tasks.length && <p>No tasks match these filters.</p>}
          {pages > 1 && (
            <nav aria-label="Task pages">
              <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page} / {pages}
              </span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </nav>
          )}
        </>
      ) : (
        <TaskDashboard
          api={api}
          admin={admin}
          people={people}
          userID={user?.id}
          refreshKey={dashboardVersion}
          onSelect={selectTask}
        />
      )}
    </div>
  )
}

function TaskEditor({
  task,
  parent,
  owner,
  people,
  busy,
  save,
  api,
  boardID,
}: {
  task: Task | null
  parent: Task | null
  owner?: Context
  people: Person[]
  busy: boolean
  save: (data: object) => Promise<void>
  api: string
  boardID?: string
}) {
  const [title, setTitle] = useState(task?.title ?? ''),
    [description, setDescription] = useState(task?.description ?? '')
  const [mentions, setMentions] = useState<Mention[]>(task?.mentions ?? [])
  const [status, setStatus] = useState(task?.status ?? 'open'),
    [priority, setPriority] = useState(task?.priority ?? 'normal')
  const [assignee, setAssignee] = useState(String(task?.assignee ?? '')),
    [date, setDate] = useState(task?.dueDate?.slice(0, 10) ?? '')
  const [region, setRegion] = useState(
    task?.region ??
      (typeof location !== 'undefined'
        ? new URLSearchParams(location.search).get('reviewRegion')
        : null) ??
      'document',
  )
  return (
    <fieldset className="review-edit" disabled={busy || task?.canEdit === false}>
      <label>
        Task title
        <input required maxLength={240} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <MentionInput
        api={api}
        taskID={task?.id}
        scope={{
          board: boardID ? Number(boardID) : undefined,
          parent: parent?.id,
          documentType: owner?.type,
          documentID: owner?.id,
          assignee: assignee ? Number(assignee) : undefined,
        }}
        label="Description"
        value={description}
        onChange={setDescription}
        mentions={mentions}
        onMentions={setMentions}
      />
      <label>
        Status
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(statuses).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select
          aria-label="Assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          aria-label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          {['low', 'normal', 'high', 'urgent'].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {!task && !parent && owner?.type === 'site-templates' && (
        <label>
          Region
          <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
            {['document', 'header', 'footer'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={busy || !title.trim()}
        onClick={() =>
          void save({
            title: title.trim(),
            description,
            mentions,
            ...(task?.updatedAt ? { expectedUpdatedAt: task.updatedAt } : {}),
            status,
            priority,
            assignee: assignee ? Number(assignee) : null,
            dueDate: date ? `${date}T12:00:00.000Z` : null,
            ...(!task
              ? {
                  initialBoard: !parent && boardID ? Number(boardID) : undefined,
                  documentType: owner?.type ?? parent?.documentType,
                  documentID: owner?.id ?? parent?.documentID,
                  region: parent?.region ?? region,
                  parent: parent?.id ?? null,
                }
              : {}),
          })
        }
      >
        {busy ? 'Saving…' : 'Save task'}
      </button>
    </fieldset>
  )
}

function Subtasks({
  api,
  task,
  select,
  add,
}: {
  api: string
  task: Task
  select: (task: Task) => void
  add: () => void
}) {
  const [children, setChildren] = useState<Task[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    void reviewAll<Task>(api, 'review-tasks', { parent: { equals: task.id } })
      .then(setChildren)
      .catch((e) => setError(e.message))
  }, [api, task])
  return (
    <section>
      <h3>Subtasks</h3>
      {error && <p role="alert">{error}</p>}
      <ul>
        {children.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => select(t)}>
              {t.title}
            </button>{' '}
            — {statuses[t.status as keyof typeof statuses]}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={task.canEdit === false || task.archived || task.status === 'done'}
        onClick={add}
      >
        Add subtask
      </button>
    </section>
  )
}

function Discussion({
  api,
  task,
  userID,
  admin,
  person,
  onChange,
}: {
  api: string
  task: Task
  userID?: number | string
  admin: boolean
  person: (id?: number) => string
  onChange?: () => Promise<void>
}) {
  const [comments, setComments] = useState<Comment[]>([]),
    [activity, setActivity] = useState<Activity[]>([])
  const [body, setBody] = useState(''),
    [editing, setEditing] = useState<number | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [mentions, setMentions] = useState<Mention[]>([])
  const refresh = useCallback(async () => {
    const where = { task: { equals: task.id } }
    const [c, a] = await Promise.all([
      reviewAll<Comment>(api, 'review-comments', where),
      reviewAll<Activity>(api, 'review-activity', where),
    ])
    setComments(c)
    setActivity(a)
    const comment = new URLSearchParams(location.search).get('comment')
    if (comment)
      requestAnimationFrame(() =>
        document.getElementById(`task-comment-${comment}`)?.scrollIntoView({ block: 'center' }),
      )
  }, [api, task])
  useEffect(() => {
    void refresh().catch((e) => setError(e.message))
  }, [refresh])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
      await onChange?.()
      setBody('')
      setMentions([])
      setEditing(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <h3>Comments</h3>
      {error && <p role="alert">{error}</p>}
      {comments.map((c) => (
        <article key={c.id} id={`task-comment-${c.id}`} tabIndex={-1}>
          <small>
            {c.authorLabel ?? person(c.author)} ·{' '}
            <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
            {c.createdAt !== c.updatedAt ? ' · edited' : ''}
          </small>
          <p>
            <SafeText text={c.body} mentions={c.mentionLabels} />
          </p>
          {!c.moderated && (c.author === userID || admin) && (
            <button
              type="button"
              onClick={() => {
                setEditing(c.id)
                setBody(c.body)
                setMentions(c.mentions ?? [])
              }}
            >
              Edit comment
            </button>
          )}
          {!c.moderated && admin && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  reviewAPI(api, `review-comments/${c.id}`, 'PATCH', { moderated: true }),
                )
              }
            >
              Moderate comment
            </button>
          )}
        </article>
      ))}
      <MentionInput
        api={api}
        taskID={task.id}
        label={editing ? 'Edit comment' : 'Add comment'}
        value={body}
        onChange={setBody}
        mentions={mentions}
        onMentions={setMentions}
        disabled={task.canComment === false || busy}
      />
      <button
        type="button"
        disabled={task.canComment === false || busy || !body.trim()}
        onClick={() =>
          void run(() =>
            reviewAPI(
              api,
              `review-comments${editing ? `/${editing}` : ''}`,
              editing ? 'PATCH' : 'POST',
              { task: task.id, body, mentions },
            ),
          )
        }
      >
        {editing ? 'Save comment' : 'Post comment'}
      </button>
      {editing && (
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setBody('')
          }}
        >
          Cancel edit
        </button>
      )}
      <details>
        <summary>Activity</summary>
        <ol>
          {activity.map((a) => (
            <li key={a.id}>
              <SafeText text={a.message} />
              <small>
                {a.actorLabel ?? person(a.actor)} · {new Date(a.createdAt).toLocaleString()}
              </small>
            </li>
          ))}
        </ol>
      </details>
    </section>
  )
}
