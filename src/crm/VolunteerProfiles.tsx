'use client'
import { useEffect, useRef, useState } from 'react'
import { ContactPicker, crmRead } from './HouseholdWorkspace'
import { ContactActivities } from './ContactActivities'
import { useVolunteerGuard, useVolunteerIO } from './useVolunteerIO'
import type { VolunteerProfile } from './volunteer-model'
import type { VolunteerRepository } from './volunteers'
import { CRMEditorDialog } from './CRMEditorDialog'
type Detail = Awaited<ReturnType<VolunteerRepository['getProfile']>>
const blank = (contact = '') => ({
  constituent: contact,
  skills: '',
  interests: '',
  availability: '',
  doNotContact: false,
  archived: false,
})
export function VolunteerProfiles({
  api,
  site,
  contact,
  initialRecord,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact?: string
  initialRecord?: string
  onDirty: (value: boolean) => void
  onSaving: (value: boolean) => void
}) {
  const io = useVolunteerIO(api, site),
    [docs, setDocs] = useState<VolunteerProfile[]>([]),
    [search, setSearch] = useState(''),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [archived, setArchived] = useState(false),
    [eligible, setEligible] = useState(false),
    [canEdit, setCanEdit] = useState(false)
  const [editor, setEditor] = useState<Detail | 'new' | null>(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(() => blank(contact)),
    [dirty, setDirty] = useState(false),
    [notesOpen, setNotesOpen] = useState(false),
    [notesDirty, setNotesDirty] = useState(false),
    [notesBusy, setNotesBusy] = useState(false),
    selection = useRef(0)
  const discard = useVolunteerGuard(
    !io.denied && (dirty || notesDirty),
    io.busy || notesBusy,
    onDirty,
    onSaving,
  )
  useEffect(() => {
    if (!site) return
    const controller = new AbortController()
    void crmRead<Awaited<ReturnType<VolunteerRepository['profiles']>>>(
      `${api}/crm/volunteers?${new URLSearchParams({ site, view: 'profiles', search, after, archived: String(archived), eligible: String(eligible), ...(contact ? { contact } : {}) })}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return
        setDocs(page.docs)
        setNext(page.next)
        setCanEdit(page.canEdit)
        io.setError('')
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setDocs([])
          setCanEdit(false)
          io.setError(cause.message)
          if ([401, 403].includes(cause.status)) {
            setEditor(null)
            setDirty(false)
            setNotesOpen(false)
          }
        }
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- io.refresh is a successful-save signal; setters are stable.
  }, [api, site, contact, search, after, archived, eligible, io.refresh])
  const open = async (row: VolunteerProfile | 'new') => {
    if (!discard()) return
    const version = ++selection.current
    setNotesOpen(false)
    setNotesDirty(false)
    setNotesBusy(false)
    io.setError('')
    if (row === 'new') {
      setEditor('new')
      setEditing(true)
      setDraft(blank(contact))
      setDirty(false)
      return
    }
    try {
      const data = await crmRead<Detail>(io.query({ view: 'profile', id: row.constituent_id }))
      if (version !== selection.current) return
      setEditor(data)
      setEditing(false)
      setDraft({
        constituent: data.doc.constituent_id,
        skills: data.doc.skills.join(', '),
        interests: data.doc.interests.join(', '),
        availability: data.doc.availability,
        doNotContact: !!data.doc.do_not_contact,
        archived: !!data.doc.archived,
      })
      setDirty(false)
    } catch (cause) {
      if (version === selection.current) {
        setEditor(null)
        io.setError((cause as Error).message)
      }
    }
  }
  const openedSearchResult = useRef('')
  useEffect(() => {
    if (initialRecord && openedSearchResult.current !== initialRecord) {
      openedSearchResult.current = initialRecord
      void open({ constituent_id: initialRecord } as VolunteerProfile)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Open once for the URL-selected profile.
  }, [initialRecord])
  const change = <K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) => {
    setDraft((old) => ({ ...old, [field]: value }))
    setDirty(true)
  }
  const save = async () => {
    if (!editor) return
    const result = await io.post({
      action: 'save-profile',
      id: editor === 'new' ? undefined : editor.doc.constituent_id,
      expectedRevision: editor === 'new' ? undefined : editor.doc.revision,
      values: {
        ...draft,
        skills: draft.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        interests: draft.interests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    })
    if (result) {
      setDirty(false)
      setEditor(null)
      setEditing(false)
      setNotesOpen(false)
      setNotesDirty(false)
    }
  }
  if (io.denied)
    return (
      <p role="alert">
        Your volunteer access changed. Reload this section to check current permissions.
      </p>
    )
  return (
    <section className="vc-crm-domain" aria-label="Volunteer profiles">
      <h3>Volunteer discovery and skills</h3>
      <p>
        This directory contains discoverable skills, interests and availability within this
        chapter’s authorized scope. Activity, hours and private communications have separate
        permissions.
      </p>
      {io.error && <p role="alert">{io.error}</p>}
      <fieldset disabled={io.busy || notesBusy || dirty || notesDirty}>
        <label>
          Search volunteers or skills
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setAfter('')
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={eligible}
            onChange={(e) => {
              setEligible(e.target.checked)
              setAfter('')
            }}
          />
          Accepting volunteer outreach only
        </label>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked)
              setAfter('')
            }}
          />
          Archived volunteer profiles
        </label>
      </fieldset>
      {canEdit && (
        <button type="button" className="vc-crm-primary" disabled={io.busy || notesBusy} onClick={() => void open('new')}>
          Create volunteer profile
        </button>
      )}
      <button
        type="button"
        disabled={!after || io.busy || dirty || notesDirty}
        onClick={() => setAfter('')}
      >
        First volunteers
      </button>
      <button
        type="button"
        disabled={!next || io.busy || dirty || notesDirty}
        onClick={() => setAfter(next || '')}
      >
        Next volunteers
      </button>
      <div className="vc-crm-table-wrap"><table>
        <thead>
          <tr>
            <th>Volunteer</th>
            <th>Skills</th>
            <th>Interests</th>
            <th>Availability</th>
            <th>Outreach</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.constituent_id} data-selected={editor !== 'new' && editor?.doc.constituent_id === d.constituent_id ? 'true' : undefined}>
              <td>
                <button type="button" disabled={io.busy || notesBusy} onClick={() => void open(d)}>
                  {d.label}
                </button>
              </td>
              <td>{d.skills.join(', ')}</td>
              <td>{d.interests.join(', ')}</td>
              <td>{d.availability}</td>
              <td>{d.contact_allowed ? 'Accepting outreach' : 'Do not contact'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!docs.length && <p>No matching volunteer profiles.</p>}
      {editor && (
        <section aria-label="Volunteer profile editor">
          <h4>{editor === 'new' ? 'New volunteer profile' : editor.doc.label}</h4>
          {editor !== 'new' && canEdit && !editing && <button type="button" onClick={() => setEditing(true)}>Edit volunteer profile</button>}
          {editing && <CRMEditorDialog title={editor === 'new' ? 'New volunteer profile' : `Edit ${editor.doc.label}`} onDismiss={() => {
            if (!discard()) return
            setEditing(false)
            if (editor === 'new') setEditor(null)
            else setDraft({
              constituent: editor.doc.constituent_id,
              skills: editor.doc.skills.join(', '),
              interests: editor.doc.interests.join(', '),
              availability: editor.doc.availability,
              doNotContact: !!editor.doc.do_not_contact,
              archived: !!editor.doc.archived,
            })
            setDirty(false)
          }}><fieldset disabled={io.busy || notesBusy || notesDirty || !canEdit}>
            {editor === 'new' && !contact ? (
              <ContactPicker
                api={api}
                site={site}
                value={draft.constituent}
                onChange={(id) => change('constituent', id)}
                label="Volunteer person"
              />
            ) : (
              <p>Profile for the selected contact</p>
            )}
            <label>
              Skills (comma separated)
              <input value={draft.skills} onChange={(e) => change('skills', e.target.value)} />
            </label>
            <label>
              Interests (comma separated)
              <input
                value={draft.interests}
                onChange={(e) => change('interests', e.target.value)}
              />
            </label>
            <label>
              Availability (discoverable)
              <textarea
                value={draft.availability}
                maxLength={2000}
                onChange={(e) => change('availability', e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.doNotContact}
                onChange={(e) => change('doNotContact', e.target.checked)}
              />
              Do not contact for volunteer opportunities in this chapter
            </label>
            <p>
              This preference persists across invitations. Declining one invitation does not change
              it. The shared contact’s volunteer-contact preference also applies.
            </p>
            {editor !== 'new' && !editor.doc.contact_allowed && !editor.doc.do_not_contact && (
              <p>The shared contact preference or archived profile currently blocks outreach.</p>
            )}
            <label>
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(e) => change('archived', e.target.checked)}
              />
              Archived profile
            </label>
            <button type="button" disabled={!draft.constituent} onClick={() => void save()}>
              Save volunteer profile
            </button>
          </fieldset></CRMEditorDialog>}
          {editor !== 'new' && editor.canNotes && (
            <>
              <button
                type="button"
                disabled={io.busy || notesBusy}
                onClick={() => {
                  if (!notesDirty || window.confirm('Discard unsaved private notes?')) {
                    setNotesOpen((v) => !v)
                    setNotesDirty(false)
                  }
                }}
              >
                Private notes and communications
              </button>
              {notesOpen && (
                <fieldset disabled={io.busy || dirty}>
                  <ContactActivities
                    key={editor.doc.constituent_id}
                    api={api}
                    site={site}
                    contact={editor.doc.constituent_id}
                    onDirty={setNotesDirty}
                    onSaving={setNotesBusy}
                  />
                </fieldset>
              )}
            </>
          )}
          <button
            type="button"
            disabled={io.busy || notesBusy}
            onClick={() => {
              if (discard()) {
                selection.current++
                setEditor(null)
                setDirty(false)
                setNotesOpen(false)
                setNotesDirty(false)
              }
            }}
          >
            Close volunteer profile
          </button>
        </section>
      )}
    </section>
  )
}
