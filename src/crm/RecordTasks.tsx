'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Clear private drafts and lookups when the explicitly pinned CRM record changes. */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { crmRead } from './HouseholdWorkspace'
import { statuses, type Task } from '../review/client'
import type { CRMRecordLink } from './record-model'
type TaskPage = {
  docs: Task[]
  total: number
  page: number
  totalPages: number
  canCreate: boolean
  record: { id: string; label: string; revision: number }
  authorityRevision: number
}
type PeoplePage = { docs: Array<{ id: number; label: string }>; next: number | null }
export function RecordTasks({
  api,
  admin,
  site,
  link,
  activity,
  defaultTitle = '',
  onDirty,
  onSaving,
}: {
  api: string
  admin: string
  site: string
  link: CRMRecordLink
  activity?: string
  defaultTitle?: string
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
}) {
  const [result, setResult] = useState<TaskPage | null>(null),
    [page, setPage] = useState(1),
    [state, setState] = useState('open'),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false),
    [saving, setSaving] = useState(false),
    [title, setTitle] = useState(defaultTitle),
    [description, setDescription] = useState(''),
    [assignee, setAssignee] = useState(''),
    [dueOn, setDueOn] = useState('')
  const [query, setQuery] = useState(''),
    [people, setPeople] = useState<PeoplePage>({ docs: [], next: null }),
    [peopleAfter, setPeopleAfter] = useState(0),
    [peopleError, setPeopleError] = useState('')
  const operation = useRef<{
      fingerprint: string
      key: string
      input: Record<string, unknown>
    } | null>(null),
    generation = useRef(0),
    callbacks = useRef({ onDirty, onSaving })
  useEffect(() => {
    callbacks.current = { onDirty, onSaving }
  }, [onDirty, onSaving])
  useEffect(() => {
    setResult(null)
    setCreating(false)
    setTitle(defaultTitle)
    setDescription('')
    setAssignee('')
    setDueOn('')
    setPeople({ docs: [], next: null })
    setPeopleAfter(0)
    setQuery('')
    setPage(1)
    operation.current = null
    callbacks.current.onDirty(false)
    // A changed suggested title alone must not overwrite a staff draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, link.type, link.id, activity])
  useEffect(() => {
    const controller = new AbortController(),
      current = ++generation.current
    async function load() {
      setLoading(true)
      setResult(null)
      setError('')
      try {
        const data = await crmRead<TaskPage>(
          `${api}/crm/tasks?${new URLSearchParams({ site, type: link.type, id: link.id, page: String(page), state })}`,
          { signal: controller.signal },
        )
        if (!controller.signal.aborted && current === generation.current) setResult(data)
      } catch (cause) {
        if (!controller.signal.aborted && current === generation.current) {
          setError((cause as Error).message)
          if ([401, 403].includes(Number((cause as { status?: number }).status))) {
            setCreating(false)
            setTitle('')
            setDescription('')
            setAssignee('')
            setDueOn('')
            setPeople({ docs: [], next: null })
            callbacks.current.onDirty(false)
          }
        }
      } finally {
        if (!controller.signal.aborted && current === generation.current) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [api, site, link.type, link.id, page, state, refresh])
  useEffect(() => {
    const focus = () => {
      if (!saving) setRefresh((value) => value + 1)
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [saving])
  useEffect(() => {
    const controller = new AbortController()
    if (!creating || !result?.canCreate) return () => controller.abort()
    const timer = setTimeout(() => {
      void crmRead<PeoplePage>(
        `${api}/crm/tasks?${new URLSearchParams({ site, type: link.type, id: link.id, view: 'people', search: query, after: String(peopleAfter) })}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setPeople((previous) => ({
              docs: peopleAfter ? [...previous.docs, ...data.docs] : data.docs,
              next: data.next,
            }))
            setPeopleError('')
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) {
            setPeople({ docs: [], next: null })
            setPeopleError(cause.message)
          }
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [
    api,
    site,
    link.type,
    link.id,
    query,
    peopleAfter,
    creating,
    result?.authorityRevision,
    result?.canCreate,
  ])
  const changed = () => {
    operation.current = null
    onDirty(true)
  }
  const clearDenied = (cause: unknown) => {
    if ([401, 403, 404].includes(Number((cause as { status?: number })?.status))) {
      setResult(null)
      setCreating(false)
      setTitle('')
      setDescription('')
      setAssignee('')
      setDueOn('')
      setPeople({ docs: [], next: null })
      operation.current = null
      onDirty(false)
    }
  }
  const busy = (value: boolean) => {
    setSaving(value)
    onSaving(value)
  }
  const create = async () => {
    if (!result || saving) return
    const input = {
        action: 'create',
        site,
        type: link.type,
        id: link.id,
        expectedRevision: result.record.revision,
        expectedAuthorityRevision: result.authorityRevision,
        title,
        description,
        assignee: assignee ? Number(assignee) : null,
        dueOn,
        activity: activity || null,
      },
      fingerprint = JSON.stringify({
        site,
        type: link.type,
        id: link.id,
        title,
        description,
        assignee,
        dueOn,
        activity,
      }),
      current = generation.current
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, key: crypto.randomUUID(), input }
    busy(true)
    setError('')
    try {
      await crmRead(`${api}/crm/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...operation.current.input, operationKey: operation.current.key }),
      })
      if (current === generation.current) {
        setCreating(false)
        setTitle(defaultTitle)
        setDescription('')
        setAssignee('')
        setDueOn('')
        onDirty(false)
        operation.current = null
        setRefresh((value) => value + 1)
      }
    } catch (cause) {
      if (current === generation.current) {
        setError((cause as Error).message)
        clearDenied(cause)
        if (Number((cause as { status?: number })?.status) === 409) operation.current = null
      }
    } finally {
      busy(false)
    }
  }
  const complete = async (task: Task) => {
    if (saving) return
    busy(true)
    setError('')
    try {
      await crmRead(`${api}/review-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-vorticause-site': site },
        body: JSON.stringify({ status: 'done', expectedUpdatedAt: task.updatedAt }),
      })
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError((cause as Error).message)
      clearDenied(cause)
    } finally {
      busy(false)
    }
  }
  return (
    <section className="vc-crm-domain" aria-label="CRM follow-up tasks">
      <div className="vc-crm-toolbar">
        <h3>Follow-up tasks</h3>
        <button type="button" disabled={saving} onClick={() => setRefresh((value) => value + 1)}>
          Refresh tasks
        </button>
        {result?.canCreate && !creating && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setTitle(defaultTitle)
              setCreating(true)
              setPeopleAfter(0)
              setQuery('')
              setPeople({ docs: [], next: null })
            }}
          >
            New follow-up
          </button>
        )}
      </div>
      <p>
        Tasks stay in the existing Tasks workspace. Access also requires permission to the linked
        CRM record.
      </p>
      {error && <p role="alert">{error}</p>}
      {creating && (
        <fieldset disabled={saving}>
          <legend>Assign a follow-up</legend>
          <p>Linked to {result?.record.label || 'this CRM record'}.</p>
          <label>
            Task title
            <input
              value={title}
              maxLength={240}
              onChange={(event) => {
                setTitle(event.target.value)
                changed()
              }}
            />
          </label>
          <label>
            Task details
            <textarea
              value={description}
              maxLength={20000}
              onChange={(event) => {
                setDescription(event.target.value)
                changed()
              }}
            />
          </label>
          <label>
            Find assignee
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPeopleAfter(0)
                setPeople({ docs: [], next: null })
              }}
            />
          </label>
          <label>
            Assign to
            <select
              value={assignee}
              onChange={(event) => {
                setAssignee(event.target.value)
                changed()
              }}
            >
              <option value="">Unassigned</option>
              {assignee && !people.docs.some((person) => String(person.id) === assignee) && (
                <option value={assignee}>Selected assignee (rechecked when saved)</option>
              )}
              {people.docs.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>
          {people.next !== null && (
            <button type="button" onClick={() => setPeopleAfter(people.next!)}>
              Load more eligible people
            </button>
          )}
          {peopleError && <p role="alert">{peopleError}</p>}
          <label>
            Follow-up due date
            <input
              type="date"
              value={dueOn}
              onChange={(event) => {
                setDueOn(event.target.value)
                changed()
              }}
            />
          </label>
          <div className="vc-crm-toolbar">
            <button
              type="button"
              disabled={!title.trim() || !result?.canCreate}
              onClick={() => void create()}
            >
              Create follow-up task
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Discard this follow-up draft?')) {
                  setCreating(false)
                  onDirty(false)
                  operation.current = null
                }
              }}
            >
              Cancel follow-up
            </button>
          </div>
        </fieldset>
      )}
      <label>
        Task status
        <select
          value={state}
          disabled={saving || creating}
          onChange={(event) => {
            setState(event.target.value)
            setPage(1)
          }}
        >
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="all">All</option>
        </select>
      </label>
      <div className="vc-crm-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Assigned to</th>
              <th>Due</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {result?.docs.map((task) => (
              <tr key={task.id}>
                <td>
                  <Link
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`${admin}/collections/review-tasks?${new URLSearchParams({ site, task: String(task.id) })}`}
                  >
                    {task.title}
                  </Link>
                </td>
                <td>{statuses[task.status as keyof typeof statuses] || task.status}</td>
                <td>
                  {task.assigneePerson?.label ||
                    task.assigneeLabel ||
                    (task.assignee ? 'Assigned' : 'Unassigned')}
                </td>
                <td>{task.dueDate?.slice(0, 10) || '—'}</td>
                <td>
                  {task.canEdit && task.status !== 'done' && (
                    <button
                      type="button"
                      disabled={saving || creating}
                      onClick={() => void complete(task)}
                    >
                      Complete {task.title}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!result?.docs.length && (
              <tr>
                <td colSpan={5}>
                  {loading ? 'Loading linked tasks…' : 'No authorized tasks match this view.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="vc-crm-toolbar">
        <span>
          {result?.total ?? 0} authorized tasks · Page {page}
        </span>
        <button
          type="button"
          disabled={loading || saving || creating || page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous tasks
        </button>
        <button
          type="button"
          disabled={loading || saving || creating || !result || page >= result.totalPages}
          onClick={() => setPage((value) => value + 1)}
        >
          Next tasks
        </button>
      </div>
    </section>
  )
}
