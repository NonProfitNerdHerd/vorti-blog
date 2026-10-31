'use client'
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { useVolunteerGuard, useVolunteerIO } from './useVolunteerIO'
import type { VolunteerActivity, VolunteerInvitation, VolunteerProfile } from './volunteer-model'
import type { VolunteerRepository } from './volunteers'
export function VolunteerInvitations({
  api,
  site,
  activity,
  contact,
  canInvite,
  canRead,
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  activity: VolunteerActivity
  contact?: string
  canInvite: boolean
  canRead: boolean
  onDirty: (v: boolean) => void
  onSaving: (v: boolean) => void
}) {
  const io = useVolunteerIO(api, site),
    [docs, setDocs] = useState<VolunteerInvitation[]>([]),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [canRespond, setCanRespond] = useState(false),
    [composer, setComposer] = useState(false),
    [responding, setResponding] = useState<VolunteerInvitation | null>(null),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState(''),
    [candidateAfter, setCandidateAfter] = useState(''),
    [candidates, setCandidates] = useState<VolunteerProfile[]>([]),
    [candidateNext, setCandidateNext] = useState<string | null>(null),
    [person, setPerson] = useState<VolunteerProfile | null>(null),
    [channel, setChannel] = useState('phone'),
    [date, setDate] = useState(''),
    [notes, setNotes] = useState(''),
    [response, setResponse] = useState('accepted')
  const discard = useVolunteerGuard(dirty && !io.denied, io.busy, onDirty, onSaving)
  useEffect(() => {
    if (!canRead) return
    const controller = new AbortController()
    void crmRead<Awaited<ReturnType<VolunteerRepository['invitations']>>>(
      `${api}/crm/volunteers?${new URLSearchParams({ site, view: 'invitations', activity: activity.id, contact: contact || '', after })}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return
        setDocs(page.docs)
        setNext(page.next)
        setCanRespond(page.canEdit)
        io.setError('')
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setDocs([])
          setCanRespond(false)
          setResponding(null)
          setDirty(false)
          io.setError(cause.message)
        }
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refresh after successful correspondence mutations.
  }, [api, site, activity.id, contact, after, canRead, io.refresh])
  useEffect(() => {
    if (!composer || !canInvite) return
    const controller = new AbortController()
    void crmRead<Awaited<ReturnType<VolunteerRepository['profiles']>>>(
      `${api}/crm/volunteers?${new URLSearchParams({ site, view: 'profiles', search, after: candidateAfter, eligible: 'true', contact: contact || '' })}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return
        setCandidates(page.docs)
        setCandidateNext(page.next)
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setCandidates([])
          setPerson(null)
          io.setError(cause.message)
        }
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This is an independent, permission-scoped recipient directory.
  }, [api, site, contact, composer, canInvite, search, candidateAfter, io.refresh])
  const begin = () => {
    if (discard()) {
      setComposer(true)
      setResponding(null)
      setPerson(null)
      setDate('')
      setNotes('')
      setDirty(false)
      setSearch('')
      setCandidateAfter('')
    }
  }
  const invite = async () => {
    if (!person) return
    const result = await io.post({
      action: 'invite',
      values: {
        activity: activity.id,
        activityRevision: activity.revision,
        constituent: person.constituent_id,
        profileRevision: person.revision,
        channel,
        occurredOn: date,
        notes,
      },
    })
    if (result) {
      setComposer(false)
      setDirty(false)
      setPerson(null)
      setNotes('')
    }
  }
  const recordResponse = async () => {
    if (!responding) return
    const result = await io.post({
      action: 'respond',
      id: responding.id,
      expectedRevision: responding.revision,
      values: { response, respondedOn: date, notes },
    })
    if (result) {
      setResponding(null)
      setDirty(false)
      setNotes('')
    }
  }
  if (io.denied)
    return (
      <p role="alert">Volunteer correspondence access changed. Reload this section to continue.</p>
    )
  return (
    <section className="vc-crm-domain" aria-label="Volunteer invitations">
      <h4>Outreach invitations and responses</h4>
      <p>
        Record staff outreach and responses here. These controls do not send correspondence. A
        decline applies to one invitation; persistent do-not-contact preferences are managed on the
        volunteer profile and shared contact.
      </p>
      {io.error && <p role="alert">{io.error}</p>}
      {canInvite && (
        <button
          type="button"
          disabled={io.busy || activity.archived === 1 || activity.state !== 'planned'}
          onClick={begin}
        >
          Record outreach invitation
        </button>
      )}
      {!canRead ? (
        <p>Communications read access is required to view invitation history.</p>
      ) : (
        <>
          <button type="button" disabled={!after || io.busy || dirty} onClick={() => setAfter('')}>
            First invitations
          </button>
          <button
            type="button"
            disabled={!next || io.busy || dirty}
            onClick={() => setAfter(next || '')}
          >
            Next invitations
          </button>
          <div className="vc-crm-table-wrap"><table>
            <thead>
              <tr>
                <th>Volunteer</th>
                <th>Outreach</th>
                <th>Response</th>
                <th>Recorded details</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.label}</td>
                  <td>
                    {d.occurred_on} — {d.channel}
                  </td>
                  <td>
                    {d.response} {d.responded_on}
                  </td>
                  <td>
                    {d.notes}
                    {d.response_notes && <p>{d.response_notes}</p>}
                  </td>
                  <td>
                    {canRespond && (
                      <button
                        type="button"
                        disabled={io.busy}
                        onClick={() => {
                          if (discard()) {
                            setResponding(d)
                            setComposer(false)
                            setResponse(d.response === 'pending' ? 'accepted' : d.response)
                            setDate('')
                            setNotes('')
                            setDirty(false)
                          }
                        }}
                      >
                        Record response for {d.label}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!docs.length && <p>No recorded outreach invitations.</p>}
        </>
      )}
      {composer && (
        <fieldset disabled={io.busy} aria-label="Outreach invitation editor">
          <legend>Recorded outreach</legend>
          <label>
            Discover volunteer skills
            <input
              type="search"
              disabled={dirty}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setCandidateAfter('')
              }}
            />
          </label>
          <label>
            Outreach volunteer
            <select
              value={person?.constituent_id || ''}
              onChange={(e) => {
                setPerson(candidates.find((c) => c.constituent_id === e.target.value) || null)
                setDirty(true)
              }}
            >
              <option value="">Choose an eligible volunteer</option>
              {candidates.map((c) => (
                <option key={c.constituent_id} value={c.constituent_id}>
                  {c.label} — {c.skills.join(', ')}
                </option>
              ))}
            </select>
          </label>
          <p>
            Only current profiles accepting volunteer outreach appear here. Consent is checked again
            when saving.
          </p>
          <button
            type="button"
            disabled={!candidateAfter || dirty}
            onClick={() => setCandidateAfter('')}
          >
            First outreach candidates
          </button>
          <button
            type="button"
            disabled={!candidateNext || dirty}
            onClick={() => setCandidateAfter(candidateNext || '')}
          >
            Next outreach candidates
          </button>
          <label>
            Outreach channel
            <select
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value)
                setDirty(true)
              }}
            >
              {['phone', 'email', 'letter', 'other'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Outreach occurred on
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setDirty(true)
              }}
            />
          </label>
          <label>
            Recorded outreach details
            <textarea
              value={notes}
              maxLength={6000}
              onChange={(e) => {
                setNotes(e.target.value)
                setDirty(true)
              }}
            />
          </label>
          <button type="button" disabled={!person || !date} onClick={() => void invite()}>
            Save recorded invitation
          </button>
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setComposer(false)
                setDirty(false)
              }
            }}
          >
            Cancel recorded invitation
          </button>
        </fieldset>
      )}
      {responding && (
        <fieldset disabled={io.busy} aria-label="Volunteer response editor">
          <legend>Response from {responding.label}</legend>
          <label>
            Invitation response
            <select
              value={response}
              onChange={(e) => {
                setResponse(e.target.value)
                setDirty(true)
              }}
            >
              <option value="accepted">Accepted</option>
              <option value="declined">Declined this invitation</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </label>
          <label>
            Response received on
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setDirty(true)
              }}
            />
          </label>
          <label>
            Response details
            <textarea
              maxLength={6000}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setDirty(true)
              }}
            />
          </label>
          <button type="button" disabled={!date} onClick={() => void recordResponse()}>
            Save invitation response
          </button>
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setResponding(null)
                setDirty(false)
              }
            }}
          >
            Close invitation response
          </button>
        </fieldset>
      )}
    </section>
  )
}
