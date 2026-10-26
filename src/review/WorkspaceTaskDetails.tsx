'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize remote attachments, typed inputs, and task details. */
import { useCallback, useEffect, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import { reviewAPI, taskSearchTerms, type Task } from './client'
import { taskDocumentLink } from './links'
import { WorkTimeProvider, TimeTrackingCell } from './TimeTracking'
import { workspaceDialog } from './WorkspaceDialogs'
import { taskFeedback } from './WorkspaceFeedback'

export type FieldDefinition = {
  id: number
  name: string
  kind: string
  systemKey?: string
  archived?: boolean
  configuration?: {
    options?: { id: string; label: string; color?: string; retired?: boolean }[]
    expression?: string
    precision?: number
    prefix?: string
  }
  updatedAt: string
}
export type FieldResult = { definition: FieldDefinition; value: unknown; error?: string }
export function WorkspaceFiles({
  api,
  task,
  board,
  linked = [],
  comment,
  canUpload = true,
  onBusy,
}: {
  api: string
  task?: number
  board?: number
  linked?: Task[]
  comment?: number
  canUpload?: boolean
  onBusy?: (busy: boolean) => void
}) {
  const {
    config: {
      routes: { admin },
    },
  } = useConfig()
  const [files, setFiles] = useState<any[]>([]),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [search, setSearch] = useState(''),
    [focusedAttachment, setFocusedAttachment] = useState(
      () =>
        new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get(
          'attachment',
        ) || '',
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const data = await reviewAPI<any>(
        api,
        `task-workspace/files?${task ? `task=${task}` : `board=${board}`}&page=${page}${comment ? `&comment=${comment}` : ''}&search=${encodeURIComponent(search)}${focusedAttachment ? `&attachment=${encodeURIComponent(focusedAttachment)}` : ''}`,
      )
      setFiles(data.docs)
      setPages(data.totalPages)
      setError('')
    } catch (e) {
      setError((e as Error).message)
      if ([403, 404].includes((e as { status?: number }).status ?? 0)) setFiles([])
    }
  }, [api, task, board, page, comment, search, focusedAttachment])
  useEffect(() => {
    onBusy?.(busy)
    return () => onBusy?.(false)
  }, [busy, onBusy])
  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])
  return (
    <section className="workspace-files">
      <header className="task-workspace-heading">
        <h3>Files and documents</h3>
        {canUpload && (
          <label className="task-primary">
            {busy ? 'Uploading…' : 'Upload file'}
            <input
              type="file"
              className="workspace-file-input"
              aria-label="Upload file"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setBusy(true)
                setError('')
                try {
                  const staged = await reviewAPI<{ id: number }>(
                    api,
                    'task-workspace/files/stage',
                    'POST',
                    { task, board, comment, filename: file.name, size: file.size },
                  )
                  const response = await fetch(`${api}/task-workspace/files/${staged.id}/content`, {
                    method: 'PUT',
                    credentials: 'same-origin',
                    body: file,
                    headers: { 'Content-Type': 'application/octet-stream' },
                  })
                  if (!response.ok) throw new Error('Upload failed. Retry the file.')
                  await load()
                  window.dispatchEvent(new Event('vorti-tasks-changed'))
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setBusy(false)
                  event.target.value = ''
                }
              }}
            />
          </label>
        )}
      </header>
      <p>Private files, up to 25 MiB each. Linked documents keep their own access rules.</p>
      {focusedAttachment && (
        <p>
          Showing the selected attachment.{' '}
          <button
            type="button"
            onClick={() => {
              setFocusedAttachment('')
              setPage(1)
              const url = new URL(location.href)
              url.searchParams.delete('attachment')
              history.replaceState(null, '', url)
            }}
          >
            Show all attachments
          </button>
        </p>
      )}
      <label>
        Find a file
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </label>
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      <ul className="workspace-file-list">
        {files
          .filter((file) => file.filename.toLowerCase().includes(search.toLowerCase()))
          .map((file) => (
            <li key={file.id}>
              <a href={`${api}/task-workspace/files/${file.id}/content`}>{file.filename}</a>
              <small>{Math.ceil(file.size / 1024)} KiB</small>
              {file.task && (
                <a
                  href={`${admin}/collections/review-tasks?${board ? `workspace=boards&board=${board}&` : ''}task=${file.task}&taskTab=${file.comment ? 'comments' : 'attachments'}${file.comment ? `&comment=${file.comment}` : ''}`}
                >
                  {file.taskTitle ?? 'Source task'}
                </a>
              )}
              {file.canDelete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm('Delete this attachment?')) return
                    setBusy(true)
                    try {
                      await reviewAPI(api, `task-workspace/files/${file.id}`, 'DELETE')
                      await load()
                    } catch (e) {
                      setError((e as Error).message)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        {[
          ...new Map(
            linked
              .filter(
                (item) =>
                  item.documentType &&
                  item.documentID &&
                  !item.documentRestricted &&
                  !item.documentDeleted,
              )
              .map((item) => [`${item.documentType}:${item.documentID}`, item]),
          ).values(),
        ]
          .filter((item) => (item.documentTitle ?? '').toLowerCase().includes(search.toLowerCase()))
          .map((item) => (
            <li key={`doc-${item.id}`}>
              <a href={taskDocumentLink(item, admin)} target="_blank" rel="noreferrer">
                {item.documentTitle || 'Linked document'}
              </a>
              <small>{item.documentType}</small>
            </li>
          ))}
      </ul>
      {!files.length && !linked.length && !error && <p>No attachments yet.</p>}
      {pages > 1 && (
        <nav aria-label="File pages">
          <button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
            Previous
          </button>
          <span>
            {page} / {pages}
          </span>
          <button disabled={page >= pages} onClick={() => setPage((v) => v + 1)}>
            Next
          </button>
        </nav>
      )}
    </section>
  )
}
export function ReferencePicker({
  api,
  value,
  onChange,
  people = false,
  disabled = false,
}: {
  api: string
  value: any[]
  onChange: (value: any[]) => void
  people?: boolean
  disabled?: boolean
}) {
  const {
    config: {
      routes: { admin },
    },
  } = useConfig()
  const [labels, setLabels] = useState<Record<string, string>>({}),
    selectedPeople = people ? value.filter((value) => typeof value === 'number').join(',') : ''
  useEffect(() => {
    if (!selectedPeople) return
    let current = true
    const load = () => {
      void reviewAPI<{ docs: { id: number; label: string }[] }>(
        api,
        `task-workspace/people?ids=${selectedPeople}`,
      )
        .then((result) => {
          if (current)
            setLabels(Object.fromEntries(result.docs.map((person) => [person.id, person.label])))
        })
        .catch(() => {})
    }
    load()
    window.addEventListener('focus', load)
    window.addEventListener('vorti-user-identity-saved', load)
    return () => {
      current = false
      window.removeEventListener('focus', load)
      window.removeEventListener('vorti-user-identity-saved', load)
    }
  }, [api, selectedPeople])
  const [collection, setCollection] = useState('review-tasks'),
    [search, setSearch] = useState(''),
    [options, setOptions] = useState<any[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      void reviewAPI<{ docs: any[] }>(
        api,
        people
          ? `task-boards/people?search=${encodeURIComponent(search)}`
          : `task-workspace/references?collection=${collection}&search=${encodeURIComponent(search)}`,
      )
        .then((data) => {
          if (current) setOptions(data.docs)
        })
        .catch((e) => {
          if (current) setError(e.message)
        })
    }, 200)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [api, collection, search, people])
  return (
    <div className="workspace-reference">
      <div className="workspace-chips">
        {value.map((item, index) => (
          <span key={index}>
            {people ? (
              (labels[String(item)] ?? `User #${item}`)
            ) : (
              <a
                href={
                  item.collection === 'review-tasks'
                    ? `${admin}/collections/review-tasks?task=${item.id}`
                    : item.collection === 'task-boards'
                      ? `${admin}/collections/review-tasks?workspace=boards&board=${item.id}`
                      : item.collection === 'task-projects'
                        ? `${admin}/collections/review-tasks?workspace=projects&project=${item.id}`
                        : `${admin}/collections/${encodeURIComponent(item.collection)}/${encodeURIComponent(item.id)}`
                }
                target="_blank"
                rel="noreferrer"
              >
                {item.label ?? `${item.collection} #${item.id}`}
              </a>
            )}
            <button
              type="button"
              disabled={disabled}
              aria-label="Remove selection"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {!people && (
        <select
          aria-label="Reference type"
          disabled={disabled}
          value={collection}
          onChange={(event) => setCollection(event.target.value)}
        >
          {[
            ['review-tasks', 'Tasks'],
            ['task-boards', 'Boards'],
            ['task-projects', 'Projects'],
            ['posts', 'Posts'],
            ['pages', 'Pages'],
          ].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      )}
      <input
        aria-label={people ? 'Find people' : 'Find a reference'}
        value={search}
        disabled={disabled}
        placeholder={people ? 'Find people…' : 'Search records…'}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select
        aria-label="Add selection"
        disabled={disabled}
        value=""
        onChange={(event) => {
          const item = options.find((option) => String(option.id) === event.target.value)
          if (!item) return
          const next = people ? item.id : { collection, id: item.id, label: item.label }
          if (
            !value.some((existing) =>
              people
                ? existing === next
                : existing.collection === collection && existing.id === item.id,
            )
          )
            onChange([...value, next])
          setSearch('')
        }}
      >
        <option value="">Add…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
export function WorkspaceFieldValue({
  api,
  result,
  disabled,
  onSave,
}: {
  api: string
  result: FieldResult
  disabled?: boolean
  onSave: (value: unknown) => Promise<void>
}) {
  const { definition, value, error } = result,
    [draft, setDraft] = useState<any>(value ?? ''),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('')
  useEffect(() => setDraft(value ?? ''), [value])
  const save = async (next: unknown) => {
    setBusy(true)
    setFailure('')
    try {
      await onSave(next)
    } catch (e) {
      setFailure((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const locked = disabled || busy,
    options = definition.configuration?.options ?? []
  let input
  if (error) input = <output>{error}</output>
  else if (definition.kind === 'time-tracking')
    input = (
      <output>
        {(Number(value ?? 0) / 3600).toFixed(definition.configuration?.precision ?? 2)} h
      </output>
    )
  else if (definition.kind === 'timer')
    input = (
      <output>
        {Math.floor(Number(value ?? 0) / 60)}:{String(Number(value ?? 0) % 60).padStart(2, '0')}
      </output>
    )
  else if (['formula', 'lookup', 'id'].includes(definition.kind))
    input = (
      <output>{error ?? (Array.isArray(value) ? value.join(', ') : String(value ?? '—'))}</output>
    )
  else if (definition.kind === 'single-select')
    input = (
      <select
        aria-label={definition.name}
        style={
          options.find((option) => option.id === draft)?.color
            ? {
                borderLeft: `4px solid ${options.find((option) => option.id === draft)!.color}`,
                background: `color-mix(in srgb, ${options.find((option) => option.id === draft)!.color} 15%, var(--theme-bg))`,
              }
            : undefined
        }
        disabled={locked}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          void save(e.target.value || null)
        }}
      >
        <option value="">—</option>
        {options
          .filter((option) => !option.retired || option.id === value)
          .map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.retired ? ' (retired)' : ''}
            </option>
          ))}
      </select>
    )
  else if (definition.kind === 'multi-select')
    input = (
      <div className="workspace-chips">
        {options
          .filter(
            (option) => !option.retired || (Array.isArray(draft) && draft.includes(option.id)),
          )
          .map((option) => (
            <label key={option.id} style={{ borderColor: option.color }}>
              <input
                type="checkbox"
                disabled={locked}
                checked={Array.isArray(draft) && draft.includes(option.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...(Array.isArray(draft) ? draft : []), option.id]
                    : (Array.isArray(draft) ? draft : []).filter((id) => id !== option.id)
                  setDraft(next)
                  void save(next)
                }}
              />
              {option.label}
            </label>
          ))}
      </div>
    )
  else if (['people', 'reference'].includes(definition.kind))
    input = (
      <ReferencePicker
        api={api}
        disabled={locked}
        people={definition.kind === 'people'}
        value={Array.isArray(draft) ? draft : []}
        onChange={(next) => {
          setDraft(next)
          void save(
            next.map((item) =>
              definition.kind === 'reference' ? { collection: item.collection, id: item.id } : item,
            ),
          )
        }}
      />
    )
  else
    input = (
      <input
        aria-label={definition.name}
        disabled={locked}
        type={
          definition.kind === 'date' ? 'date' : definition.kind === 'number' ? 'number' : 'text'
        }
        step={definition.kind === 'number' ? 'any' : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft === '' ? null : definition.kind === 'number' ? Number(draft) : draft
          if (next !== value) void save(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
    )
  return (
    <div className="workspace-field-value">
      {input}
      {failure && <small role="alert">{failure}</small>}
    </div>
  )
}
export function WorkspaceTaskDetails({
  api,
  task,
  onChange,
  section = 'all',
  boardID,
  beforeWrite,
}: {
  beforeWrite?: () => Promise<string | undefined>
  section?: 'all' | 'details' | 'dependencies'
  boardID?: string
  api: string
  task: Task
  onChange: () => void
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [seconds, setSeconds] = useState(1500),
    [clock, setClock] = useState(() => Date.now()),
    [dependency, setDependency] = useState<any[]>([])
  const load = useCallback(async () => {
    try {
      setData(await reviewAPI(api, `task-workspace/tasks/${task.id}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, task.id, task.updatedAt])
  useEffect(() => {
    void load()
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [load])
  const run = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    try {
      const revision = await beforeWrite?.()
      await reviewAPI(api, `task-workspace/tasks/${task.id}`, 'POST', {
        expectedUpdatedAt: revision ?? task.updatedAt,
        ...body,
      })
      await load()
      onChange()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <WorkTimeProvider
      api={api}
      tasks={[task]}
      onChanged={async () => {
        await load()
        onChange()
      }}
    >
      <section className="workspace-task-extra">
        {error && (
          <p role="alert">
            {error} <button onClick={() => void load()}>Reload</button>
          </p>
        )}
        {section !== 'dependencies' && data?.fields?.length > 0 && (
          <>
            <h3>Custom fields</h3>
            <div className="workspace-field-grid">
              {data.fields
                .filter(
                  (field: FieldResult) =>
                    section === 'all' || field.definition.kind !== 'time-tracking',
                )
                .map((field: FieldResult) => (
                  <div className="workspace-property" key={field.definition.id}>
                    <span>{field.definition.name}</span>
                    {field.definition.kind === `time-tracking` ? (
                      <TimeTrackingCell task={task} fallback={Number(field.value ?? 0)} />
                    ) : (
                      <WorkspaceFieldValue
                        api={api}
                        result={field}
                        disabled={task.canEdit === false || busy}
                        onSave={async (value) => {
                          const revision = await beforeWrite?.()
                          await reviewAPI(api, `task-workspace/tasks/${task.id}`, 'POST', {
                            action: 'field',
                            field: field.definition.id,
                            value,
                            expectedUpdatedAt: revision ?? task.updatedAt,
                          })
                          taskFeedback(task, 'updated')
                          await load()
                          onChange()
                        }}
                      />
                    )}
                    {field.definition.kind === 'timer' &&
                      (() => {
                        const timer = data.countdowns.find(
                            (item: any) => item.field === field.definition.id,
                          ),
                          remaining = timer?.endsAt
                            ? Math.max(0, Math.ceil((Date.parse(timer.endsAt) - clock) / 1000))
                            : (timer?.remainingSeconds ?? seconds)
                        return (
                          <div>
                            <output>
                              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                            </output>
                            <input
                              aria-label="Countdown minutes"
                              type="number"
                              min="0"
                              max="10080"
                              value={seconds / 60}
                              onChange={(e) => setSeconds(Number(e.target.value) * 60)}
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run({
                                  action: 'countdown',
                                  field: field.definition.id,
                                  seconds: timer?.endsAt ? remaining : seconds,
                                  running: !timer?.endsAt,
                                })
                              }
                            >
                              {timer?.endsAt ? 'Pause' : 'Start countdown'}
                            </button>
                          </div>
                        )
                      })()}
                  </div>
                ))}
            </div>
          </>
        )}
        {section !== 'details' && (
          <>
            <h3>Predecessors</h3>
            <ul>
              {data?.dependencies?.map((item: any) => (
                <li key={item.id}>
                  {item.unavailable ? 'Restricted task' : item.title}
                  {item.status === 'done' ? ' · Complete' : ''}
                  {task.canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ action: 'remove-dependency', dependency: item.id })}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {task.canEdit && (
              <>
                <BoardDependencyPicker
                  api={api}
                  task={task}
                  boardID={boardID}
                  value={dependency}
                  onChange={setDependency}
                />
                <button
                  type="button"
                  disabled={
                    busy || dependency.length !== 1 || dependency[0]?.collection !== 'review-tasks'
                  }
                  onClick={() => void run({ action: 'dependency', predecessor: dependency[0].id })}
                >
                  Add finish-to-start dependency
                </button>
              </>
            )}
            <h3>Successors</h3>
            <ul>
              {data?.successors?.map((item: any) => (
                <li key={item.id}>{item.unavailable ? 'Restricted task' : item.title}</li>
              ))}
            </ul>
          </>
        )}
        {section === 'all' && (
          <>
            <h3>Tracked time</h3>
            <TimeTrackingCell task={task} fallback={data?.time?.seconds ?? 0} />
          </>
        )}
      </section>
    </WorkTimeProvider>
  )
}

function BoardDependencyPicker({
  api,
  task,
  boardID,
  value,
  onChange,
}: {
  api: string
  task: Task
  boardID?: string
  value: any[]
  onChange: (items: any[]) => void
}) {
  const [search, setSearch] = useState(''),
    [tasks, setTasks] = useState<Task[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const boards = boardID ? [Number(boardID)] : (task.boards ?? [])
    if (!boards.length) return
    const params = new URLSearchParams({
      depth: '0',
      limit: '50',
      where: JSON.stringify({
        and: [
          { boards: { in: boards } },
          { id: { not_equals: task.id } },
          { archived: { not_equals: true } },
          ...taskSearchTerms(search).map((term) => ({ title: { contains: term } })),
        ],
      }),
    })
    const timer = setTimeout(() => {
      void reviewAPI<{ docs: Task[] }>(api, `review-tasks?${params}`)
        .then((data) => {
          if (active) {
            setTasks(data.docs)
            setError('')
          }
        })
        .catch((error) => {
          if (active) setError(error.message)
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [api, boardID, task.id, search])
  return (
    <div className="workspace-dependency-picker">
      <label>
        Find a task on this board
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <label>
        Predecessor
        <select
          value={value[0]?.id ?? ''}
          onChange={(event) =>
            onChange(
              event.target.value
                ? [{ collection: 'review-tasks', id: Number(event.target.value) }]
                : [],
            )
          }
        >
          <option value="">Choose a task</option>
          {tasks.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
