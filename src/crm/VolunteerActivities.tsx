'use client'
import { RecordAttachmentLink } from './RecordAttachmentLink'
import { useEffect, useRef, useState } from 'react'
import { ContactPicker, crmRead } from './HouseholdWorkspace'
import { VolunteerHours } from './VolunteerHours'
import { VolunteerInvitations } from './VolunteerInvitations'
import { useVolunteerGuard, useVolunteerIO } from './useVolunteerIO'
import type { VolunteerActivity, VolunteerParticipation } from './volunteer-model'
import { volunteerParticipationStates } from './volunteer-model'
import type { VolunteerRepository } from './volunteers'
type Detail = Awaited<ReturnType<VolunteerRepository['getActivity']>>
const blank = () => ({
  name: '',
  description: '',
  location: '',
  startsOn: '',
  endsOn: '',
  skills: '',
  state: 'planned',
  archived: false,
})
const draftOf = (doc: VolunteerActivity) => ({
  name: doc.name,
  description: doc.description,
  location: doc.location,
  startsOn: doc.starts_on,
  endsOn: doc.ends_on,
  skills: doc.skills.join(', '),
  state: doc.state as string,
  archived: !!doc.archived,
})
export function VolunteerActivities({
  api,
  site,
  contact,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  contact?: string
  onDirty: (v: boolean) => void
  onSaving: (v: boolean) => void
}) {
  const io = useVolunteerIO(api, site),
    [docs, setDocs] = useState<VolunteerActivity[]>([]),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [archived, setArchived] = useState(false),
    [linkedOnly, setLinkedOnly] = useState(!!contact),
    [canEdit, setCanEdit] = useState(false),
    [editor, setEditor] = useState<Detail | 'new' | null>(null),
    [draft, setDraft] = useState(blank),
    [dirty, setDirty] = useState(false),
    [participant, setParticipant] = useState<VolunteerParticipation | 'new' | null>(null),
    [person, setPerson] = useState(contact || ''),
    [status, setStatus] = useState<string>('registered'),
    [participationNotes, setParticipationNotes] = useState(''),
    [partDirty, setPartDirty] = useState(false),
    [childDirty, setChildDirty] = useState(false),
    [childBusy, setChildBusy] = useState(false),
    [panel, setPanel] = useState<'participants' | 'invitations' | 'hours'>('participants'),
    selection = useRef(0)
  const discard = useVolunteerGuard(
    !io.denied && (dirty || partDirty || childDirty),
    io.busy || childBusy,
    onDirty,
    onSaving,
  )
  useEffect(() => {
    const controller = new AbortController()
    void crmRead<Awaited<ReturnType<VolunteerRepository['activities']>>>(
      `${api}/crm/volunteers?${new URLSearchParams({ site, view: 'activities', after, archived: String(archived), contact: linkedOnly ? contact || '' : '' })}`,
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
            setParticipant(null)
            setPartDirty(false)
            setChildDirty(false)
          }
        }
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refresh the existing list after successful activity mutations.
  }, [api, site, contact, linkedOnly, after, archived, io.refresh])
  const open = async (row: VolunteerActivity | 'new') => {
    if (!discard()) return
    const version = ++selection.current
    setParticipant(null)
    setPartDirty(false)
    setChildDirty(false)
    setPanel('participants')
    io.setError('')
    if (row === 'new') {
      setEditor('new')
      setDraft(blank())
      setDirty(false)
      return
    }
    try {
      const data = await crmRead<Detail>(io.query({ view: 'activity', id: row.id }))
      if (version === selection.current) {
        setEditor(data)
        setDraft(draftOf(data.doc))
        setDirty(false)
      }
    } catch (cause) {
      if (version === selection.current) {
        setEditor(null)
        io.setError((cause as Error).message)
      }
    }
  }
  const refreshDetail = async (id: string, after = '') => {
    const version = selection.current
    const data = await crmRead<Detail>(io.query({ view: 'activity', id, after }))
    if (version === selection.current) setEditor(data)
  }
  const save = async () => {
    if (!editor) return
    const result = await io.post({
      action: 'save-activity',
      id: editor === 'new' ? undefined : editor.doc.id,
      expectedRevision: editor === 'new' ? undefined : editor.doc.revision,
      values: {
        ...draft,
        skills: draft.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    })
    if (result) {
      setDirty(false)
      try {
        await refreshDetail(result.id)
      } catch (cause) {
        io.setError((cause as Error).message)
      }
    }
  }
  const change = <K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) => {
    setDraft((old) => ({ ...old, [field]: value }))
    setDirty(true)
  }
  const beginParticipation = (row: VolunteerParticipation | 'new') => {
    if (!discard()) return
    setParticipant(row)
    setPerson(row === 'new' ? contact || '' : row.constituent_id)
    setStatus(row === 'new' ? 'registered' : row.state)
    setParticipationNotes(row === 'new' ? '' : row.notes)
    setPartDirty(false)
  }
  const saveParticipation = async () => {
    if (!editor || editor === 'new' || !participant) return
    const result = await io.post({
      action: 'participate',
      id: participant === 'new' ? undefined : participant.id,
      expectedRevision: participant === 'new' ? undefined : participant.revision,
      values: {
        activity: editor.doc.id,
        activityRevision: editor.doc.revision,
        constituent: person,
        state: status,
        notes: participationNotes,
      },
    })
    if (result) {
      setPartDirty(false)
      setParticipant(null)
      try {
        await refreshDetail(editor.doc.id)
      } catch (cause) {
        io.setError((cause as Error).message)
      }
    }
  }
  const choosePanel = (next: typeof panel) => {
    if (next === panel || !discard()) return
    setPanel(next)
    setChildDirty(false)
    setParticipant(null)
    setPartDirty(false)
    setDirty(false)
    if (editor && editor !== 'new') setDraft(draftOf(editor.doc))
  }
  if (io.denied)
    return (
      <p role="alert">Volunteer activity access changed. Reload this section before continuing.</p>
    )
  return (
    <section className="vc-crm-domain" aria-label="Volunteer activities">
      <h3>Private chapter volunteer activities</h3>
      <p>
        These activities and participation records require chapter activity access. Skills discovery
        alone does not reveal them.
      </p>
      {io.error && <p role="alert">{io.error}</p>}
      {contact && (
        <label>
          <input
            type="checkbox"
            disabled={io.busy || childBusy || dirty || partDirty || childDirty}
            checked={linkedOnly}
            onChange={(e) => {
              setLinkedOnly(e.target.checked)
              setAfter('')
            }}
          />
          Only activities with this contact’s recorded participation
        </label>
      )}
      <label>
        <input
          type="checkbox"
          disabled={io.busy || childBusy || dirty || partDirty || childDirty}
          checked={archived}
          onChange={(e) => {
            setArchived(e.target.checked)
            setAfter('')
          }}
        />
        Archived volunteer activities
      </label>
      {canEdit && (
        <button type="button" disabled={io.busy || childBusy} onClick={() => void open('new')}>
          Create volunteer activity
        </button>
      )}
      <button
        type="button"
        disabled={!after || io.busy || childBusy || dirty || partDirty || childDirty}
        onClick={() => setAfter('')}
      >
        First activities
      </button>
      <button
        type="button"
        disabled={!next || io.busy || childBusy || dirty || partDirty || childDirty}
        onClick={() => setAfter(next || '')}
      >
        Next activities
      </button>
      <table>
        <thead>
          <tr>
            <th>Activity</th>
            <th>Dates</th>
            <th>Location</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>
                <button type="button" disabled={io.busy || childBusy} onClick={() => void open(d)}>
                  {d.name}
                </button>
              </td>
              <td>
                {d.starts_on} – {d.ends_on}
              </td>
              <td>{d.location}</td>
              <td>{d.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!docs.length && <p>No matching volunteer activities.</p>}
      {editor && (
        <section aria-label="Volunteer activity editor">
          <h4>{editor === 'new' ? 'New volunteer activity' : editor.doc.name}</h4>
          {editor !== 'new' && <RecordAttachmentLink site={site} link={{ type: 'volunteer-activity', id: editor.doc.id }} />}
          <fieldset disabled={io.busy || childBusy || partDirty || childDirty || !canEdit}>
            <label>
              Activity name
              <input
                value={draft.name}
                maxLength={180}
                onChange={(e) => change('name', e.target.value)}
              />
            </label>
            <label>
              Activity description
              <textarea
                value={draft.description}
                maxLength={6000}
                onChange={(e) => change('description', e.target.value)}
              />
            </label>
            <label>
              Activity location
              <input
                value={draft.location}
                maxLength={1000}
                onChange={(e) => change('location', e.target.value)}
              />
            </label>
            <label>
              Activity starts on
              <input
                type="date"
                value={draft.startsOn}
                onChange={(e) => change('startsOn', e.target.value)}
              />
            </label>
            <label>
              Activity ends on
              <input
                type="date"
                value={draft.endsOn}
                onChange={(e) => change('endsOn', e.target.value)}
              />
            </label>
            <label>
              Needed skills (comma separated)
              <input value={draft.skills} onChange={(e) => change('skills', e.target.value)} />
            </label>
            <label>
              Activity state
              <select value={draft.state} onChange={(e) => change('state', e.target.value)}>
                {['planned', 'completed', 'cancelled'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(e) => change('archived', e.target.checked)}
              />
              Archived activity
            </label>
            <button
              type="button"
              disabled={!draft.name.trim() || !draft.startsOn || !draft.endsOn}
              onClick={() => void save()}
            >
              Save volunteer activity
            </button>
          </fieldset>
          {editor !== 'new' && (
            <>
              <nav className="vc-crm-toolbar" aria-label="Volunteer activity sections">
                <button
                  type="button"
                  aria-pressed={panel === 'participants'}
                  onClick={() => choosePanel('participants')}
                >
                  Participation
                </button>
                {(editor.canInvite || editor.canReadInvitations) && (
                  <button
                    type="button"
                    aria-pressed={panel === 'invitations'}
                    onClick={() => choosePanel('invitations')}
                  >
                    Invitations and responses
                  </button>
                )}
                {editor.canReadHours && (
                  <button
                    type="button"
                    aria-pressed={panel === 'hours'}
                    onClick={() => choosePanel('hours')}
                  >
                    Activity hours
                  </button>
                )}
              </nav>
              {panel === 'participants' && (
                <section aria-label="Volunteer participation">
                  <h4>Participation and attendance</h4>
                  {contact && (
                    <p>The selected contact can be registered explicitly for this activity.</p>
                  )}
                  {editor.canEdit && (
                    <button
                      type="button"
                      disabled={
                        io.busy ||
                        childBusy ||
                        dirty ||
                        childDirty ||
                        editor.doc.archived === 1 ||
                        editor.doc.state === 'cancelled'
                      }
                      onClick={() => beginParticipation('new')}
                    >
                      Register volunteer participation
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={io.busy || dirty || partDirty || childDirty}
                    onClick={() =>
                      void refreshDetail(editor.doc.id).catch((cause) => io.setError(cause.message))
                    }
                  >
                    First participants
                  </button>
                  <button
                    type="button"
                    disabled={io.busy || dirty || partDirty || childDirty || !editor.next}
                    onClick={() =>
                      void refreshDetail(editor.doc.id, editor.next || '').catch((cause) =>
                        io.setError(cause.message),
                      )
                    }
                  >
                    Next participants
                  </button>
                  <table>
                    <thead>
                      <tr>
                        <th>Volunteer</th>
                        <th>Attendance</th>
                        <th>Chapter activity details</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editor.participants.map((p) => (
                        <tr key={p.id}>
                          <td>{p.label}</td>
                          <td>{p.state}</td>
                          <td>{p.notes}</td>
                          <td>
                            {editor.canEdit && (
                              <button
                                type="button"
                                disabled={io.busy || dirty || childDirty}
                                onClick={() => beginParticipation(p)}
                              >
                                Edit attendance for {p.label}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!editor.participants.length && <p>No recorded participants.</p>}
                  {participant && (
                    <fieldset
                      disabled={io.busy || dirty || childDirty}
                      aria-label="Volunteer participation editor"
                    >
                      <legend>Record participation</legend>
                      {participant === 'new' && !contact ? (
                        <ContactPicker
                          api={api}
                          site={site}
                          value={person}
                          onChange={(id) => {
                            setPerson(id)
                            setPartDirty(true)
                          }}
                          label="Participating person"
                        />
                      ) : (
                        <p>{participant === 'new' ? 'Selected contact' : participant.label}</p>
                      )}
                      <label>
                        Participation status
                        <select
                          value={status}
                          onChange={(e) => {
                            setStatus(e.target.value)
                            setPartDirty(true)
                          }}
                        >
                          {volunteerParticipationStates.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Chapter participation details
                        <textarea
                          maxLength={4000}
                          value={participationNotes}
                          onChange={(e) => {
                            setParticipationNotes(e.target.value)
                            setPartDirty(true)
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!person}
                        onClick={() => void saveParticipation()}
                      >
                        Save participation
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (discard()) {
                            setParticipant(null)
                            setPartDirty(false)
                          }
                        }}
                      >
                        Cancel participation editor
                      </button>
                    </fieldset>
                  )}
                </section>
              )}
              {panel === 'invitations' && (
                <fieldset disabled={io.busy || dirty || partDirty}>
                  <VolunteerInvitations
                    key={editor.doc.id}
                    api={api}
                    site={site}
                    activity={editor.doc}
                    contact={contact}
                    canInvite={editor.canInvite}
                    canRead={editor.canReadInvitations}
                    onDirty={setChildDirty}
                    onSaving={setChildBusy}
                  />
                </fieldset>
              )}
              {panel === 'hours' && (
                <fieldset disabled={io.busy || dirty || partDirty}>
                  <VolunteerHours
                    key={editor.doc.id}
                    api={api}
                    site={site}
                    activity={editor.doc.id}
                    contact={contact}
                    participants={editor.participants}
                    onDirty={setChildDirty}
                    onSaving={setChildBusy}
                  />
                </fieldset>
              )}
            </>
          )}
          <button
            type="button"
            disabled={io.busy || childBusy}
            onClick={() => {
              if (discard()) {
                selection.current++
                setEditor(null)
                setDirty(false)
                setPartDirty(false)
                setChildDirty(false)
                setParticipant(null)
              }
            }}
          >
            Close volunteer activity
          </button>
        </section>
      )}
    </section>
  )
}
