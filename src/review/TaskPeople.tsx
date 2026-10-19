'use client'
import { useState } from 'react'
import { EditorDialog } from '@design-system/payload-design-core/admin'
import { PersonAvatar, type AccessPerson } from './BoardOverview'
import type { Task } from './client'
export function CollaboratorPicker({
  people,
  value,
  primary,
  onChange,
  disabled = false,
}: {
  people: AccessPerson[]
  value: number[]
  primary?: number
  onChange: (ids: number[]) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  return (
    <details className="workspace-collaborator-picker">
      <summary>Collaborators ({value.filter((id) => id !== primary).length})</summary>
      <p>
        Collaborators must already have access. The primary assignee remains responsible for the
        task.
      </p>
      <label>
        Find collaborators
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div>
        {people
          .filter(
            (person) =>
              person.id !== primary &&
              `${person.label} ${person.username ?? ''}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((person) => (
            <label key={person.id}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.includes(person.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, person.id]
                      : value.filter((id) => id !== person.id),
                  )
                }
              />
              {person.username ? `@${person.username}` : person.label}
            </label>
          ))}
      </div>
    </details>
  )
}
export function TaskAssignees({
  task,
  people,
  disabled,
  onSave,
}: {
  task: Task
  people: AccessPerson[]
  disabled: boolean
  onSave: (data: object) => Promise<void>
}) {
  const [open, setOpen] = useState(false),
    [primary, setPrimary] = useState(String(task.assignee ?? '')),
    [collaborators, setCollaborators] = useState(task.collaborators ?? []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const person =
    task.assigneePerson ??
    people.find((person) => person.id === task.assignee) ??
    (task.assignee
      ? { id: task.assignee, label: task.assigneeLabel ?? 'Assigned user' }
      : undefined)
  const avatars = [
    ...(person ? [{ ...person, primary: true }] : []),
    ...(task.collaboratorPeople ?? [])
      .filter((item) => item.id !== task.assignee)
      .map((item) => ({ ...item, primary: false })),
  ]
  return (
    <>
      <button
        type="button"
        className="workspace-assignee-stack workspace-bare-control"
        aria-label={`Edit assignee and collaborators for ${task.title}`}
        disabled={disabled}
        onClick={() => {
          setPrimary(String(task.assignee ?? ''))
          setCollaborators(task.collaborators ?? [])
          setError('')
          setOpen(true)
        }}
      >
        {avatars.length ? (
          avatars.map((person) => (
            <span
              key={person.id}
              className={person.primary ? 'workspace-primary-avatar' : ''}
              title={`${person.primary ? 'Primary assignee: ' : 'Collaborator: '}${person.username ? '@' + person.username : person.label}`}
            >
              <PersonAvatar person={person} />
            </span>
          ))
        ) : (
          <span className="workspace-user-unassigned">◯</span>
        )}
        <span className="workspace-assignee-label">{person?.label ?? 'Unassigned'}</span>
      </button>
      {open && (
        <EditorDialog
          open
          title={`People — ${task.title}`}
          onClose={() => {
            if (
              !busy &&
              ((primary === String(task.assignee ?? '') &&
                JSON.stringify(collaborators) === JSON.stringify(task.collaborators ?? [])) ||
                confirm('Discard unsaved people changes?'))
            )
              setOpen(false)
          }}
        >
          <div className="workspace-settings">
            <label>
              Primary assignee
              <select
                value={primary}
                onChange={(event) => {
                  setPrimary(event.target.value)
                  setCollaborators((ids) => ids.filter((id) => String(id) !== event.target.value))
                }}
              >
                <option value="">Unassigned</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.label}
                  </option>
                ))}
              </select>
            </label>
            <CollaboratorPicker
              people={people}
              value={collaborators}
              primary={primary ? Number(primary) : undefined}
              onChange={setCollaborators}
              disabled={busy}
            />
            {error && <p role="alert">{error}</p>}
            <button
              type="button"
              className="task-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onSave({
                    assignee: primary ? Number(primary) : null,
                    collaborators: collaborators.filter((id) => String(id) !== primary),
                  })
                  setOpen(false)
                } catch (error) {
                  setError((error as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save people
            </button>
          </div>
        </EditorDialog>
      )}
    </>
  )
}
