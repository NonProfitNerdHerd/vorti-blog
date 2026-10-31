'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load the selected contact's saved associations on context change. */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { ContactSummary } from './contacts'
import { CRMEditorDialog } from './CRMEditorDialog'

type LinkRow = { id: string; organization_id: string; person_id: string; organization_label: string; person_label: string;
  role: string; starts_on: string; ends_on: string | null; notes: string; primary_contact: number; revision: number }
type Draft = { person: string; role: string; startsOn: string; endsOn: string; notes: string; primary: boolean }
const blank = (): Draft => ({ person: '', role: '', startsOn: new Date().toISOString().slice(0, 10), endsOn: '', notes: '', primary: false })
export function OrganizationContactPeople({ api, admin, site, contact, kind, onDirty, onSaving }: {
  api: string; admin: string; site: string; contact: string; kind: 'person' | 'organization';
  onDirty: (value: boolean) => void; onSaving: (value: boolean) => void
}) {
  const [docs, setDocs] = useState<LinkRow[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<LinkRow | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(blank)
  const [people, setPeople] = useState<ContactSummary[]>([])
  const [personSearch, setPersonSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [draftDirty, setDraftDirty] = useState(false)
  const operation = useRef<string | null>(null)
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${api}/crm/organization-contacts?${new URLSearchParams({ site, contact })}`, { cache: 'no-store' })
      const data = await response.json() as { docs?: LinkRow[]; canEdit?: boolean; message?: string }
      if (!response.ok) throw new Error(data.message || 'Unable to load organization contacts.')
      setDocs(data.docs || [])
      setCanEdit(Boolean(data.canEdit))
      setError('')
    } catch (cause) { setError((cause as Error).message) }
  }, [api, site, contact])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!editing || editing !== 'new' || personSearch.trim().length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${api}/crm/contacts?${new URLSearchParams({ site, kind: 'person', search: personSearch, limit: '20' })}`, { cache: 'no-store', signal: controller.signal })
        if (response.ok) setPeople(((await response.json()) as { docs: ContactSummary[] }).docs)
      } catch { /* Search is optional; saving still checks the chosen person. */ }
    }, 180)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [api, site, editing, personSearch])
  const change = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setDraftDirty(true); onDirty(true); operation.current = null }
  const close = () => { if (busy || (draftDirty && !window.confirm('Discard unsaved contact person changes?'))) return; setEditing(null); setDraftDirty(false); onDirty(false); setError('') }
  const edit = (row: LinkRow | 'new') => {
    setEditing(row)
    setDraft(row === 'new' ? blank() : { person: row.person_id, role: row.role, startsOn: row.starts_on, endsOn: row.ends_on || '', notes: row.notes, primary: row.primary_contact === 1 })
    setPersonSearch('')
    setPeople([])
    setError('')
    setDraftDirty(false)
    onDirty(false)
  }
  const save = async () => {
    if (!draft.person || !draft.startsOn || busy) return
    setBusy(true); onSaving(true); setError('')
    operation.current ||= crypto.randomUUID()
    try {
      const response = await fetch(`${api}/crm/organization-contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, organization: contact, person: draft.person, role: draft.role, startsOn: draft.startsOn,
          endsOn: draft.endsOn || null, notes: draft.notes, primary: draft.primary, id: editing === 'new' ? undefined : editing?.id,
          expectedRevision: editing === 'new' ? undefined : editing?.revision, operationKey: operation.current }) })
      const data = await response.json() as { message?: string }
      if (!response.ok) throw new Error(data.message || 'Unable to save contact person.')
      setEditing(null); setDraftDirty(false); onDirty(false); operation.current = null; await load()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false); onSaving(false) }
  }
  const link = (row: LinkRow) => `${admin}/crm?${new URLSearchParams({ view: kind === 'organization' ? 'contacts' : 'organizations', site,
    contact: kind === 'organization' ? row.person_id : row.organization_id, contactTab: 'information', infoSection: 'relationships' })}`
  return <div className="vc-crm-organization-people" onKeyDown={event => {
    if (editing && event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault()
  }}>
    <header className="vc-crm-section-heading"><h3>{kind === 'organization' ? 'Contact people' : 'Organizations'}</h3>
      {canEdit && <button type="button" onClick={() => edit('new')}>Add contact person</button>}</header>
    {error && !editing && <p role="alert">{error}</p>}
    {docs.length ? <div className="vc-crm-table"><table><thead><tr><th>{kind === 'organization' ? 'Person' : 'Organization'}</th><th>Role</th><th>Dates</th><th>Primary</th>{canEdit && <th>Action</th>}</tr></thead>
      <tbody>{docs.map(row => <tr key={row.id}><td><Link href={link(row)}>{kind === 'organization' ? row.person_label : row.organization_label}</Link></td>
        <td>{row.role || '—'}</td><td>{row.starts_on}{row.ends_on ? ` – ${row.ends_on}` : ' – present'}</td><td>{row.primary_contact ? 'Yes' : '—'}</td>
        {canEdit && <td><button type="button" onClick={() => edit(row)}>Edit</button></td>}</tr>)}</tbody></table></div> : <p>No {kind === 'organization' ? 'contact people' : 'organizations'} linked yet.</p>}
    {editing && <CRMEditorDialog title={editing === 'new' ? 'Add contact person' : 'Edit contact person'} onDismiss={close}>
      {editing === 'new' && <><label>Find person<input type="search" value={personSearch} onChange={event => setPersonSearch(event.target.value)} placeholder="Search contacts" /></label>
        <label>Person<select value={draft.person} onChange={event => change({ person: event.target.value })}><option value="">Choose a person</option>
          {people.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}</select></label></>}
      {editing !== 'new' && <p>{editing.person_label}</p>}
      <div className="vc-crm-fields"><label>Role<input value={draft.role} maxLength={100} onChange={event => change({ role: event.target.value })} /></label>
        <label>Start date<input type="date" value={draft.startsOn} onChange={event => change({ startsOn: event.target.value })} /></label>
        <label>End date<input type="date" value={draft.endsOn} onChange={event => change({ endsOn: event.target.value, primary: event.target.value ? false : draft.primary })} /></label></div>
      <label>Notes<textarea value={draft.notes} maxLength={1000} onChange={event => change({ notes: event.target.value })} /></label>
      <label className="vc-crm-check"><input type="checkbox" checked={draft.primary} disabled={Boolean(draft.endsOn)} onChange={event => change({ primary: event.target.checked })} />Primary contact</label>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="vc-crm-primary" disabled={busy || !draft.person || !draft.startsOn} onClick={() => void save()}>{busy ? 'Saving…' : 'Save contact person'}</button>
    </CRMEditorDialog>}
  </div>
}
