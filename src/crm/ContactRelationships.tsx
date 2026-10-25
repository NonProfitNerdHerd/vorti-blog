'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Reload explicitly pinned contact relationships on context change. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ContactPicker, crmRead } from './HouseholdWorkspace'
import type { Relationship, RelationshipType } from './households'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Data = {
  docs: Relationship[]
  next: string | null
  types: RelationshipType[]
  households: Array<{
    id: string
    name: string
    role: string
    started_on: string
    ended_on: string | null
  }>
  canEdit: boolean
}
export function ContactRelationships({
  api,
  site,
  contact,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact: string
  onDirty: (dirty: boolean) => void
  onSaving: (busy: boolean) => void
}) {
  const pathname = usePathname()
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [after, setAfter] = useState('')
  const [target, setTarget] = useState(''),
    [type, setType] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [notes, setNotes] = useState('')
  const [label, setLabel] = useState(''),
    [reciprocal, setReciprocal] = useState(''),
    [editing, setEditing] = useState<Relationship | null>(null)
  const [editingType, setEditingType] = useState<RelationshipType | null>(null),
    [typeArchived, setTypeArchived] = useState(false)
  const generation = useRef(0),
    operation = useRef<{ fingerprint: string; key: string } | null>(null)
  const load = useCallback(async () => {
    const version = ++generation.current
    try {
      const result = await crmRead<Data>(
        `${api}/crm/households?site=${encodeURIComponent(site)}&contact=${encodeURIComponent(contact)}&after=${encodeURIComponent(after)}`,
      )
      if (version === generation.current) {
        setData(result)
        setError('')
      }
    } catch (cause) {
      if (version === generation.current) {
        setData(null)
        setError((cause as Error).message)
      }
    }
  }, [api, site, contact, after])
  useEffect(() => {
    void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate current async requests; this is a monotonic counter, not a DOM ref.
      generation.current++
    }
  }, [load])
  const change = () => {
    onDirty(true)
    operation.current = null
  }
  const mutate = async (
    action: string,
    values: Record<string, unknown>,
    id?: string,
    revision?: number,
  ) => {
    const version = generation.current
    setBusy(true)
    onSaving(true)
    setError('')
    const body = { site, action, values, id, expectedRevision: revision },
      fingerprint = JSON.stringify(body)
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, key: crypto.randomUUID() }
    try {
      await crmRead(`${api}/crm/households`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, operationKey: operation.current.key }),
      })
      if (version !== generation.current) return
      operation.current = null
      onDirty(false)
      setEditing(null)
      setEditingType(null)
      setTarget('')
      setNotes('')
      setEnd('')
      setLabel('')
      setReciprocal('')
      await load()
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message)
        if ([401, 403].includes((cause as { status: number }).status)) setData(null)
      }
    } finally {
      setBusy(false)
      onSaving(false)
    }
  }
  return (
    <section className="vc-crm-domain">
      <h3>Households and relationships</h3>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <h4>Household history</h4>
          {data.households.length ? (
            <ul>
              {data.households.map((h) => (
                <li key={`${h.id}:${h.started_on}`}>
                  <Link
                    href={`${pathname}?${new URLSearchParams({ view: 'households', site, household: h.id })}`}
                    onClick={(event) => {
                      if (busy) event.preventDefault()
                    }}
                  >
                    {h.name}
                  </Link>{' '}
                  — {h.role || 'Member'}, {h.started_on} through {h.ended_on || 'present'}
                </li>
              ))}
            </ul>
          ) : (
            <p>No household memberships in this chapter.</p>
          )}
          <h4>Relationships</h4>
          <table>
            <thead>
              <tr>
                <th>Relationship</th>
                <th>Contact</th>
                <th>Dates</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.docs.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>
                    <Link
                      href={`${pathname}?${new URLSearchParams({ view: 'contacts', site, contact: r.other_id, contactTab: 'relationships' })}`}
                      onClick={(event) => {
                        if (busy) event.preventDefault()
                      }}
                    >
                      {r.other_label}
                    </Link>
                  </td>
                  <td>
                    {r.started_on} – {r.ended_on || 'present'}
                  </td>
                  <td>{r.notes}</td>
                  <td>
                    {data.canEdit && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditing(r)
                          setStart(r.started_on)
                          setEnd(r.ended_on || '')
                          setNotes(r.notes)
                          change()
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.docs.length && <p>No relationships in this chapter.</p>}
          <button type="button" disabled={!after || busy} onClick={() => setAfter('')}>
            First page
          </button>
          <button
            type="button"
            disabled={!data.next || busy}
            onClick={() => setAfter(data.next || '')}
          >
            Next page
          </button>
          {data.canEdit && (
            <>
              <fieldset disabled={busy}>
                <legend>{editing ? 'Edit relationship' : 'Add relationship'}</legend>
                {!editing && (
                  <>
                    <ContactPicker
                      api={api}
                      site={site}
                      value={target}
                      onChange={(id) => {
                        setTarget(id)
                        change()
                      }}
                      label="Related contact"
                    />
                    <label>
                      This contact is the
                      <select
                        value={type}
                        onChange={(e) => {
                          setType(e.target.value)
                          change()
                        }}
                      >
                        <option value="">Choose relationship</option>
                        {data.types
                          .filter((t) => !t.archived)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label} (reciprocal: {t.reciprocal_label})
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                )}
                <label>
                  From
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value)
                      change()
                    }}
                  />
                </label>
                <label>
                  Through (optional)
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value)
                      change()
                    }}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    maxLength={4000}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value)
                      change()
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!start || (!editing && (!target || !type))}
                  onClick={() =>
                    void mutate(
                      editing ? 'update-relationship' : 'create-relationship',
                      { source: contact, target, type, startedOn: start, endedOn: end, notes },
                      editing?.id,
                      editing?.revision,
                    )
                  }
                >
                  Save relationship
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null)
                      setNotes('')
                      setEnd('')
                      onDirty(false)
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </fieldset>
              <details>
                <summary>Manage relationship types</summary>
                <ul>
                  {data.types.map((t) => (
                    <li key={t.id}>
                      {t.label} / {t.reciprocal_label}
                      {t.archived ? ' (archived)' : ''}{' '}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingType(t)
                          setLabel(t.label)
                          setReciprocal(t.reciprocal_label)
                          setTypeArchived(!!t.archived)
                          change()
                        }}
                      >
                        Edit type
                      </button>
                    </li>
                  ))}
                </ul>
                <fieldset disabled={busy}>
                  <legend>{editingType ? 'Edit type' : 'New relationship type'}</legend>
                  <label>
                    Forward label
                    <input
                      maxLength={120}
                      value={label}
                      onChange={(e) => {
                        setLabel(e.target.value)
                        change()
                      }}
                      placeholder="Employer"
                    />
                  </label>
                  <label>
                    Reciprocal label
                    <input
                      maxLength={120}
                      value={reciprocal}
                      onChange={(e) => {
                        setReciprocal(e.target.value)
                        change()
                      }}
                      placeholder="Employee"
                    />
                  </label>
                  {editingType && (
                    <label>
                      <input
                        type="checkbox"
                        checked={typeArchived}
                        onChange={(e) => {
                          setTypeArchived(e.target.checked)
                          change()
                        }}
                      />
                      Archived
                    </label>
                  )}
                  <button
                    type="button"
                    disabled={!label.trim() || !reciprocal.trim()}
                    onClick={() =>
                      void mutate(
                        editingType ? 'update-type' : 'create-type',
                        {
                          label,
                          reciprocalLabel: reciprocal,
                          archived: editingType ? typeArchived : false,
                        },
                        editingType?.id,
                        editingType?.revision,
                      )
                    }
                  >
                    Save type
                  </button>
                  {editingType && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingType(null)
                        setLabel('')
                        setReciprocal('')
                        onDirty(false)
                      }}
                    >
                      Cancel type edit
                    </button>
                  )}
                </fieldset>
              </details>
            </>
          )}
        </>
      )}
    </section>
  )
}
