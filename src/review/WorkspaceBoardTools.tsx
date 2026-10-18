'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Synchronize owner forms and discussion state with loaded workspace records. */
import { useCallback, useEffect, useState } from 'react'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { RenderLexical } from '@payloadcms/richtext-lexical/client'
import { useAuth } from '@payloadcms/ui'
import { query, reviewAPI, reviewAll } from './client'
import { MentionInput } from './MentionInput'
import type { Mention } from './mentions'
import type { FieldDefinition } from './WorkspaceTaskDetails'
import { ReferencePicker } from './WorkspaceTaskDetails'
import { workspaceDialog } from './WorkspaceDialogs'

const kinds = [
  'single-select',
  'multi-select',
  'date',
  'people',
  'reference',
  'lookup',
  'text',
  'number',
  'formula',
  'id',
  'timer',
  'time-tracking',
]
const viewTypes = [
  'overview',
  'list',
  'board',
  'calendar',
  'timeline',
  'gantt',
  'dashboard',
  'files',
  'page',
  'messages',
  'embed',
  'workload',
  'timesheets',
]
export function FieldManager({
  api,
  board,
  onClose,
  onSaved,
}: {
  api: string
  board: number
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [library, setLibrary] = useState<FieldDefinition[]>([]),
    [attached, setAttached] = useState<any[]>([]),
    [name, setName] = useState(''),
    [kind, setKind] = useState('text'),
    [options, setOptions] = useState<
      { id: string; label: string; color: string; retired?: boolean }[]
    >([]),
    [expression, setExpression] = useState(''),
    [reference, setReference] = useState(''),
    [property, setProperty] = useState('title'),
    [precision, setPrecision] = useState(2),
    [prefix, setPrefix] = useState(''),
    [editing, setEditing] = useState<FieldDefinition>(),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setLibrary(await reviewAll(api, 'task-field-definitions', {}))
    setAttached(await reviewAll(api, 'task-board-fields', { board: { equals: board } }, 'position'))
  }, [api, board])
  useEffect(() => {
    void load().catch((e) => setError(e.message))
  }, [load])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      await onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <EditorDialog
      open
      title="Custom fields"
      onClose={() => {
        if (!name || confirm('Discard the field draft?')) onClose()
      }}
    >
      <div className="workspace-settings">
        <p>
          Reusable field names and options are visible in the shared library. Keep confidential
          information in task values. Shared task values update everywhere this field is used.
        </p>
        {error && <p role="alert">{error}</p>}
        <label>
          Find a field
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <ul className="workspace-library">
          {library
            .filter((field) => field.name.toLowerCase().includes(search.toLowerCase()))
            .map((field) => {
              const placement = attached.find((item) => item.field === field.id)
              return (
                <li key={field.id}>
                  <span>
                    {field.name}{' '}
                    <small>
                      {field.kind} · [f{field.id}]{field.archived ? ' · Archived' : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    disabled={busy || (!placement && field.archived)}
                    onClick={() =>
                      void run(async () => {
                        if (placement)
                          await reviewAPI(api, `task-board-fields/${placement.id}`, 'DELETE')
                        else
                          await reviewAPI(api, 'task-board-fields', 'POST', {
                            board,
                            field: field.id,
                            position: attached.length,
                          })
                      })
                    }
                  >
                    {placement ? 'Remove column' : 'Add column'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await reviewAPI(api, `task-field-definitions/${field.id}`, 'PATCH', {
                          archived: !field.archived,
                          expectedUpdatedAt: field.updatedAt,
                        })
                      })
                    }
                  >
                    {field.archived ? 'Restore' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(field)
                      setName(field.name)
                      setKind(field.kind)
                      setOptions(
                        (field.configuration?.options ?? []).map((option) => ({
                          ...option,
                          color: option.color ?? '#8b5cf6',
                        })),
                      )
                      setExpression(field.configuration?.expression ?? '')
                      setPrecision(field.configuration?.precision ?? 2)
                      setPrefix(field.configuration?.prefix ?? '')
                      setReference(String((field.configuration as any)?.referenceField ?? ''))
                      setProperty((field.configuration as any)?.property ?? 'title')
                    }}
                  >
                    Edit definition
                  </button>
                </li>
              )
            })}
        </ul>
        <h3>{editing ? 'Edit reusable definition' : 'Create reusable field'}</h3>
        <label>
          Name
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        {['single-select', 'multi-select'].includes(kind) && (
          <fieldset>
            <legend>Options</legend>
            {options.map((option, index) => (
              <div className="task-workspace-toolbar" key={option.id}>
                <input
                  aria-label={`Option ${index + 1}`}
                  value={option.label}
                  onChange={(e) =>
                    setOptions((values) =>
                      values.map((value, i) =>
                        i === index ? { ...value, label: e.target.value } : value,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Option ${index + 1} color`}
                  type="color"
                  value={option.color}
                  onChange={(e) =>
                    setOptions((values) =>
                      values.map((value, i) =>
                        i === index ? { ...value, color: e.target.value } : value,
                      ),
                    )
                  }
                />
                <label>
                  <input
                    type="checkbox"
                    checked={!!option.retired}
                    onChange={(e) =>
                      setOptions((values) =>
                        values.map((value, i) =>
                          i === index ? { ...value, retired: e.target.checked } : value,
                        ),
                      )
                    }
                  />
                  Retired
                </label>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setOptions((values) => [
                  ...values,
                  { id: crypto.randomUUID(), label: 'New option', color: '#8b5cf6' },
                ])
              }
            >
              Add option
            </button>
          </fieldset>
        )}
        {kind === 'number' && (
          <label>
            Decimal places
            <input
              type="number"
              min={0}
              max={6}
              value={precision}
              onChange={(e) => setPrecision(Number(e.target.value))}
            />
          </label>
        )}
        {kind === 'id' && (
          <label>
            Display prefix
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </label>
        )}
        {kind === 'formula' && (
          <>
            <label>
              Expression
              <textarea
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="[f12] * 2"
              />
            </label>
            <p>
              Use field IDs above. Functions: sum, min, max, round, abs, if, concat, lower, upper,
              length, days, adddays, hours. Strings use double quotes. days takes a start and end
              date; hours converts seconds.
            </p>
            <FormulaPreview api={api} expression={expression} />
            <button
              type="button"
              onClick={() => {
                try {
                  import('./workspace-formula').then(({ workspaceReferences }) => {
                    try {
                      workspaceReferences(expression)
                      setError('Expression syntax is valid. Results appear on each task.')
                    } catch (e) {
                      setError((e as Error).message)
                    }
                  })
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
            >
              Validate expression
            </button>
          </>
        )}
        {kind === 'lookup' && (
          <>
            <label>
              Reference field
              <select value={reference} onChange={(e) => setReference(e.target.value)}>
                <option value="">Choose…</option>
                {library
                  .filter((field) => field.kind === 'reference')
                  .map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Direct property
              <select value={property} onChange={(e) => setProperty(e.target.value)}>
                {[
                  'title',
                  'name',
                  'description',
                  'status',
                  'priority',
                  'dueDate',
                  'startDate',
                  'milestone',
                  'archived',
                  'slug',
                  'excerpt',
                ].map((property) => (
                  <option key={property}>{property}</option>
                ))}
              </select>
            </label>
            <p>Restricted references display as unavailable. Lookup chains are not supported.</p>
          </>
        )}
        <button
          type="button"
          className="task-primary"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              const result = await reviewAPI<any>(
                api,
                `task-field-definitions${editing ? `/${editing.id}` : ''}`,
                editing ? 'PATCH' : 'POST',
                {
                  name,
                  kind,
                  configuration: {
                    options: ['single-select', 'multi-select'].includes(kind) ? options : undefined,
                    expression: kind === 'formula' ? expression : undefined,
                    referenceField: kind === 'lookup' ? Number(reference) : undefined,
                    property: kind === 'lookup' ? property : undefined,
                    precision,
                    prefix,
                  },
                  ...(editing ? { expectedUpdatedAt: editing.updatedAt } : {}),
                },
              )
              if (!editing)
                await reviewAPI(api, 'task-board-fields', 'POST', {
                  board,
                  field: result.doc.id,
                  position: attached.length,
                })
              setEditing(undefined)
              setName('')
              setOptions([])
            })
          }
        >
          {busy ? 'Saving…' : editing ? 'Save definition' : 'Create and add field'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined)
              setName('')
            }}
          >
            Cancel edit
          </button>
        )}
      </div>
    </EditorDialog>
  )
}
function FormulaPreview({ api, expression }: { api: string; expression: string }) {
  const [selection, setSelection] = useState<any[]>([]),
    [preview, setPreview] = useState('Choose an accessible task to preview this expression.')
  useEffect(() => {
    if (selection.length !== 1 || selection[0].collection !== 'review-tasks') return
    let current = true
    const timer = setTimeout(() => {
      void reviewAPI<{ value: unknown }>(api, 'task-workspace/formula-preview', 'POST', {
        task: selection[0].id,
        expression,
      })
        .then((result) => {
          if (current) setPreview(String(result.value))
        })
        .catch((error) => {
          if (current) setPreview(error.message)
        })
    }, 350)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [api, expression, selection])
  return (
    <fieldset>
      <legend>Live preview</legend>
      <ReferencePicker
        api={api}
        value={selection}
        onChange={(value) => setSelection(value.slice(-1))}
      />
      <output aria-live="polite">{preview}</output>
    </fieldset>
  )
}
export function ViewManager({
  api,
  board,
  views,
  onClose,
  onSaved,
}: {
  api: string
  board: number
  views: any[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(''),
    [kind, setKind] = useState('list'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      setError('')
      await action()
      await onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <EditorDialog open title="Board views" onClose={onClose}>
      <div className="workspace-settings">
        {error && <p role="alert">{error}</p>}
        <ul className="workspace-library">
          {views.map((view, index) => (
            <li key={view.id}>
              <span>
                {view.name}{' '}
                <small>
                  {view.kind}
                  {view.defaultView ? ' · Default' : ''}
                </small>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void workspaceDialog({
                    title: 'Rename view',
                    fields: [
                      { name: 'name', label: 'View name', value: view.name, required: true },
                    ],
                    onSave: async (values) => {
                      await reviewAPI(api, `task-views/${view.id}`, 'PATCH', {
                        name: values.name,
                        expectedUpdatedAt: view.updatedAt,
                      })
                      await onSaved()
                    },
                  })
                }
              >
                Rename
              </button>
              <button
                type="button"
                disabled={busy || index === 0}
                onClick={() =>
                  void run(async () => {
                    await reviewAPI(api, `task-views/${view.id}`, 'PATCH', {
                      position: views[index - 1].position - 1,
                      expectedUpdatedAt: view.updatedAt,
                    })
                  })
                }
              >
                Move left
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await reviewAPI(api, `task-workspace/views/${view.id}`, 'POST', {
                      action: 'duplicate',
                      expectedUpdatedAt: view.updatedAt,
                    })
                  })
                }
              >
                Duplicate
              </button>
              <button
                type="button"
                disabled={busy || view.defaultView}
                onClick={() =>
                  void run(async () => {
                    await reviewAPI(api, `task-workspace/views/${view.id}`, 'POST', {
                      action: 'default',
                      expectedUpdatedAt: view.updatedAt,
                    })
                  })
                }
              >
                Make default
              </button>
              <button
                type="button"
                disabled={busy || views.length <= 1 || view.defaultView}
                onClick={() => {
                  if (confirm('Remove this view? Tasks and custom-field values are retained.'))
                    void run(async () => {
                      await reviewAPI(api, `task-views/${view.id}`, 'DELETE')
                    })
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <label>
          View name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          View type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {viewTypes.map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <button
          className="task-primary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await reviewAPI(api, 'task-views', 'POST', {
                board,
                name: name.trim() || kind[0].toUpperCase() + kind.slice(1),
                kind,
                position: views.length,
              })
              setName('')
            })
          }
        >
          Add view
        </button>
      </div>
    </EditorDialog>
  )
}
export function BoardPage({
  api,
  board,
  view,
  canEdit,
}: {
  api: string
  board: number
  view: { id: number }
  canEdit: boolean
}) {
  const [record, setRecord] = useState<any>(),
    [value, setValue] = useState<any>(),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [dirty, setDirty] = useState(false)
  useEffect(() => {
    void reviewAPI<any>(
      api,
      `task-board-pages?${query({ and: [{ board: { equals: board } }, { view: { equals: view.id } }] })}`,
    )
      .then((data) => {
        setRecord(data.docs[0])
        setValue(data.docs[0]?.body)
        setDirty(false)
      })
      .catch((e) => setError(e.message))
  }, [api, board, view.id])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (
        dirty &&
        link &&
        link.target !== '_blank' &&
        !event.ctrlKey &&
        !event.metaKey &&
        link.href !== location.href &&
        !confirm('Discard unsaved board page changes?')
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.dispatchEvent(new CustomEvent('vorti-board-page-dirty', { detail: dirty }))
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', navigate, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', navigate, true)
      window.dispatchEvent(new CustomEvent('vorti-board-page-dirty', { detail: false }))
    }
  }, [dirty])
  return (
    <section className="workspace-page">
      <p>
        A shared board document. Save before switching views; simultaneous edits require a reload.
      </p>
      {error && <p role="alert">{error}</p>}
      <RenderLexical
        schemaPath="collection.task-board-pages.body"
        path={`workspace-page-${view.id}`}
        value={value}
        setValue={(next) => {
          setValue(next)
          setDirty(true)
          setSaved(false)
        }}
        field={{ name: 'body', type: 'richText', admin: { readOnly: !canEdit } }}
      />
      <button
        type="button"
        disabled={!canEdit || !dirty || !value}
        className="task-primary"
        onClick={async () => {
          try {
            const result = await reviewAPI<any>(
              api,
              `task-board-pages${record ? `/${record.id}` : ''}`,
              record ? 'PATCH' : 'POST',
              { board, view: view.id, body: value, expectedUpdatedAt: record?.updatedAt },
            )
            setRecord(result.doc)
            setSaved(true)
            setDirty(false)
            setError('')
          } catch (e) {
            setError((e as Error).message)
          }
        }}
      >
        Save page
      </button>
      {saved && <p role="status">Page saved.</p>}
    </section>
  )
}
export function BoardMessages({
  api,
  board,
  canComment,
}: {
  api: string
  board: number
  canComment: boolean
}) {
  const [messages, setMessages] = useState<any[]>([]),
    [body, setBody] = useState(''),
    [mentions, setMentions] = useState<Mention[]>([]),
    [parent, setParent] = useState<number>(),
    [error, setError] = useState(''),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [followers, setFollowers] = useState<any[]>([]),
    [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const result = await reviewAPI<any>(
        api,
        `task-board-messages?${query({ board: { equals: board } }, { limit: '50', page: String(page), sort: 'createdAt' })}`,
      )
      setMessages(result.docs)
      setPages(result.totalPages)
      setFollowers(await reviewAll(api, 'task-message-followers', {}))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, board, page])
  useEffect(() => {
    void load()
  }, [load])
  const requested =
    typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('thread')
  return (
    <section>
      <h3>Messages</h3>
      {error && <p role="alert">{error}</p>}
      <ul className="workspace-message-list">
        {messages.map((message) => {
          const follower = followers.find(
            (follower) => follower.thread === (message.parent ?? message.id),
          )
          return (
            <li
              key={message.id}
              id={`workspace-message-${message.id}`}
              className={`${message.parent ? 'workspace-message-reply' : ''} ${String(message.id) === requested ? 'workspace-highlight' : ''}`}
            >
              <small>
                {message.authorLabel ?? `User #${message.author}`} ·{' '}
                {new Date(message.createdAt).toLocaleString()}
              </small>
              <p style={{ whiteSpace: 'pre-wrap' }}>{message.displayBody ?? message.body}</p>
              {canComment && (
                <button type="button" onClick={() => setParent(message.parent ?? message.id)}>
                  Reply
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    await reviewAPI(
                      api,
                      `task-message-followers${follower ? `/${follower.id}` : ''}`,
                      follower ? 'PATCH' : 'POST',
                      { thread: message.parent ?? message.id, following: !follower?.following },
                    )
                    await load()
                  } catch (e) {
                    setError((e as Error).message)
                  }
                }}
              >
                {follower?.following ? 'Unfollow' : 'Follow'}
              </button>
            </li>
          )
        })}
      </ul>
      {!messages.length && <p>Start a discussion with your board.</p>}
      {pages > 1 && (
        <nav aria-label="Message pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
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
      {canComment && (
        <>
          <h4>{parent ? `Reply to discussion #${parent}` : 'New discussion'}</h4>
          {parent && (
            <button type="button" onClick={() => setParent(undefined)}>
              Cancel reply
            </button>
          )}
          <MentionInput
            api={api}
            scope={{ board }}
            label="Message"
            value={body}
            onChange={setBody}
            mentions={mentions}
            onMentions={setMentions}
          />
          <button
            className="task-primary"
            type="button"
            disabled={busy || !body.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await reviewAPI(api, 'task-board-messages', 'POST', {
                  board,
                  parent: parent ?? null,
                  body,
                  mentions,
                })
                setBody('')
                setMentions([])
                setParent(undefined)
                await load()
                window.dispatchEvent(new Event('vorti-tasks-changed'))
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            Post message
          </button>
        </>
      )}
    </section>
  )
}
export function EmbedView({
  api,
  board,
  view,
  owner,
  onSaved,
}: {
  api: string
  board: number
  view: any
  owner: boolean
  onSaved: () => Promise<void>
}) {
  const [url, setUrl] = useState(view.configuration?.url ?? ''),
    [origins, setOrigins] = useState<string[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    { user } = useAuth()
  useEffect(() => {
    void reviewAPI<any>(api, 'globals/system-settings')
      .then((data) => setOrigins(data.workspaceEmbedOrigins ?? []))
      .catch((e) => setError(e.message))
  }, [api])
  let permitted = false
  try {
    permitted =
      new URL(view.configuration?.url).protocol === 'https:' &&
      origins.includes(new URL(view.configuration.url).origin)
  } catch {}
  return (
    <section>
      <h3>External content</h3>
      <p>
        Embedded services may receive your IP address and their own cookies. Access to a board does
        not grant access to the external service.
      </p>
      {error && <p role="alert">{error}</p>}
      {owner && (
        <>
          <label>
            HTTPS URL
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={async () => {
              try {
                await reviewAPI(api, `task-views/${view.id}`, 'PATCH', {
                  configuration: { url },
                  expectedUpdatedAt: view.updatedAt,
                })
                setLoaded(false)
                await onSaved()
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Save embed
          </button>
        </>
      )}
      {user?.role === 'administrator' && (
        <>
          <label>
            Allowed HTTPS origins
            <textarea
              value={origins.join('\n')}
              onChange={(e) =>
                setOrigins(
                  e.target.value
                    .split('\n')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              try {
                await reviewAPI(api, 'globals/system-settings', 'POST', {
                  workspaceEmbedOrigins: origins,
                })
                setError('Allowed origins saved.')
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            Save allowed origins
          </button>
        </>
      )}
      {permitted ? (
        loaded ? (
          <iframe
            title={view.name}
            src={view.configuration.url}
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
            className="workspace-embed"
          />
        ) : (
          <button type="button" className="task-primary" onClick={() => setLoaded(true)}>
            Load external content
          </button>
        )
      ) : (
        <p>Choose an HTTPS URL from an administrator-approved origin.</p>
      )}
    </section>
  )
}
export function ProjectBoardSharing({
  api,
  board,
  onClose,
  onSaved,
}: {
  api: string
  board: any
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [projects, setProjects] = useState<any[]>([]),
    [project, setProject] = useState(String(board.project ?? '')),
    [inherit, setInherit] = useState(!!board.inheritProject),
    [preview, setPreview] = useState<any>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    void reviewAll<any>(api, 'task-projects', {})
      .then(setProjects)
      .catch((e) => setError(e.message))
  }, [api])
  return (
    <EditorDialog open title="Project and board access" onClose={onClose}>
      <div className="workspace-settings">
        <p>
          Inherited boards use project roles. Private boards retain separate members. Administrators
          retain oversight.
        </p>
        <label>
          Project
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value)
              setPreview(undefined)
            }}
          >
            <option value="">Choose…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={inherit}
            onChange={(e) => {
              setInherit(e.target.checked)
              setPreview(undefined)
            }}
          />{' '}
          Inherit project membership
        </label>
        {error && <p role="alert">{error}</p>}
        {preview && (
          <p>
            {preview.warning} {preview.taskCount} parent tasks affected; {preview.approvalsRequired}{' '}
            owner approvals.
          </p>
        )}
        <button
          type="button"
          className="task-primary"
          disabled={busy || !project}
          onClick={async () => {
            setBusy(true)
            try {
              const result = await reviewAPI<any>(api, 'task-workspace/project-sharing', 'POST', {
                action: preview ? 'request' : 'preview',
                board: board.id,
                project: Number(project),
                inheritProject: inherit,
                confirm: !!preview,
              })
              if (!preview) setPreview(result)
              else {
                setError(
                  result.pending
                    ? 'Sharing request sent. Owners must approve before access changes.'
                    : 'Board access updated.',
                )
                await onSaved()
              }
            } catch (e) {
              setError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {preview ? 'Confirm audience change' : 'Preview audience change'}
        </button>
      </div>
    </EditorDialog>
  )
}
