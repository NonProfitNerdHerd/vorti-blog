'use client'
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import { useVolunteerGuard, useVolunteerIO } from './useVolunteerIO'
import type { VolunteerHours as Hours, VolunteerParticipation } from './volunteer-model'
import type { VolunteerRepository } from './volunteers'
import { CRMEditorDialog } from './CRMEditorDialog'
export function volunteerDuration(minutes: string | number) {
  const n = BigInt(minutes)
  return `${n / 60n} h ${n % 60n} min`
}
export function VolunteerHours({
  api,
  site,
  activity,
  contact,
  participants = [],
  onDirty,
  onSaving,
}: {
  api: string
  site: string
  activity?: string
  contact?: string
  participants?: VolunteerParticipation[]
  onDirty: (v: boolean) => void
  onSaving: (v: boolean) => void
}) {
  const io = useVolunteerIO(api, site),
    [docs, setDocs] = useState<Hours[]>([]),
    [totals, setTotals] = useState<Array<{ state: string; records: number; minutes: string }>>([]),
    [after, setAfter] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [state, setState] = useState('all'),
    [canEdit, setCanEdit] = useState(false),
    [review, setReview] = useState<Hours | null>(null),
    [reviewState, setReviewState] = useState<'approved' | 'rejected'>('approved'),
    [reason, setReason] = useState(''),
    [submitting, setSubmitting] = useState(false),
    [person, setPerson] = useState(contact || ''),
    [date, setDate] = useState(''),
    [minutes, setMinutes] = useState(''),
    [dirty, setDirty] = useState(false)
  const discard = useVolunteerGuard(dirty && !io.denied, io.busy, onDirty, onSaving)
  useEffect(() => {
    const controller = new AbortController()
    void crmRead<Awaited<ReturnType<VolunteerRepository['hours']>>>(
      `${api}/crm/volunteers?${new URLSearchParams({ site, view: 'hours', activity: activity || '', contact: contact || '', state, after })}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (controller.signal.aborted) return
        setDocs(page.docs)
        setTotals(page.totals)
        setNext(page.next)
        setCanEdit(page.canEdit)
        io.setError('')
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setDocs([])
          setTotals([])
          setCanEdit(false)
          if ([401, 403].includes(cause.status)) {
            setReview(null)
            setSubmitting(false)
            setDirty(false)
          }
          io.setError(cause.message)
        }
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- io.refresh is a successful mutation signal.
  }, [api, site, activity, contact, state, after, io.refresh])
  const submit = async () => {
    const result = await io.post({
      action: 'submit-hours',
      values: { activity, constituent: person, occurredOn: date, minutes: Number(minutes) },
    })
    if (result) {
      setSubmitting(false)
      setDirty(false)
      setMinutes('')
      setDate('')
    }
  }
  const saveReview = async () => {
    if (!review) return
    const result = await io.post({
      action: 'review-hours',
      id: review.id,
      expectedRevision: review.revision,
      values: { state: reviewState, reason },
    })
    if (result) {
      setReview(null)
      setDirty(false)
      setReason('')
    }
  }
  if (io.denied)
    return <p role="alert">Hours access changed. Reload this section before continuing.</p>
  return (
    <section className="vc-crm-domain" aria-label="Volunteer hours">
      <h4>Volunteer hours and approval</h4>
      {io.error && <p role="alert">{io.error}</p>}
      <p>
        Submitted time and approved time are separate. These totals cover all authorized matching
        records, including records on later pages.
      </p>
      <ul>
        {totals.map((t) => (
          <li key={t.state}>
            {t.state}: {volunteerDuration(t.minutes)} ({t.records} records)
          </li>
        ))}
      </ul>
      <label>
        Hours status
        <select
          disabled={io.busy || dirty}
          value={state}
          onChange={(e) => {
            setState(e.target.value)
            setAfter('')
          }}
        >
          {['all', 'submitted', 'approved', 'rejected'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {activity && canEdit && (
        <button
          type="button"
          disabled={io.busy}
          onClick={() => {
            if (discard()) {
              setSubmitting(true)
              setReview(null)
              setPerson(contact || '')
              setDate('')
              setMinutes('')
              setDirty(false)
            }
          }}
        >
          Record volunteer hours
        </button>
      )}
      {!activity && (
        <p>To record new hours, open the volunteer activity and mark the person attended.</p>
      )}
      <button type="button" disabled={!after || io.busy || dirty} onClick={() => setAfter('')}>
        First hours
      </button>
      <button
        type="button"
        disabled={!next || io.busy || dirty}
        onClick={() => setAfter(next || '')}
      >
        Next hours
      </button>
      <div className="vc-crm-table-wrap"><table>
        <thead>
          <tr>
            <th>Volunteer</th>
            <th>Activity</th>
            <th>Date</th>
            <th>Time</th>
            <th>Status</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.label}</td>
              <td>{d.activity_name}</td>
              <td>{d.occurred_on}</td>
              <td>{volunteerDuration(d.minutes)}</td>
              <td>
                {d.state}
                {d.review_reason ? `: ${d.review_reason}` : ''}
              </td>
              <td>
                {canEdit && (
                  <button
                    type="button"
                    disabled={io.busy}
                    onClick={() => {
                      if (discard()) {
                        setReview(d)
                        setReviewState(d.state === 'rejected' ? 'rejected' : 'approved')
                        setReason('')
                        setSubmitting(false)
                        setDirty(false)
                      }
                    }}
                  >
                    Review {d.label} {d.occurred_on}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!docs.length && <p>No matching volunteer hours.</p>}
      {submitting && <CRMEditorDialog title="Record volunteer hours" onDismiss={() => {
        if (discard()) { setSubmitting(false); setDirty(false) }
      }}>
        <fieldset disabled={io.busy} aria-label="Volunteer hours submission">
          <legend>Submit dated hours</legend>
          <label>
            Attended volunteer
            <select
              value={person}
              onChange={(e) => {
                setPerson(e.target.value)
                setDirty(true)
              }}
            >
              <option value="">Choose attended participant</option>
              {participants
                .filter((p) => p.state === 'attended' && (!contact || p.constituent_id === contact))
                .map((p) => (
                  <option key={p.id} value={p.constituent_id}>
                    {p.label}
                  </option>
                ))}
            </select>
          </label>
          <p>
            The choices reflect the current participant page. Open another participant page if
            needed before recording hours.
          </p>
          <label>
            Hours occurred on
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
            Whole minutes
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value)
                setDirty(true)
              }}
            />
          </label>
          <button
            type="button"
            disabled={!person || !date || !minutes}
            onClick={() => void submit()}
          >
            Submit volunteer hours
          </button>
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setSubmitting(false)
                setDirty(false)
              }
            }}
          >
            Cancel hours submission
          </button>
        </fieldset>
      </CRMEditorDialog>}
      {review && <CRMEditorDialog title="Review volunteer hours" onDismiss={() => {
        if (discard()) { setReview(null); setDirty(false) }
      }}>
        <fieldset disabled={io.busy} aria-label="Volunteer hours review">
          <legend>Review recorded time</legend>
          <p>
            {review.label}: {volunteerDuration(review.minutes)} on {review.occurred_on}
          </p>
          <label>
            Review outcome
            <select
              value={reviewState}
              onChange={(e) => {
                setReviewState(e.target.value as 'approved' | 'rejected')
                setDirty(true)
              }}
            >
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            Hours review reason
            <input
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setDirty(true)
              }}
            />
          </label>
          <p>
            Original submitted time is retained. For a correction, reject the old record with a
            reason and enter a separate corrected submission.
          </p>
          <button type="button" disabled={!reason.trim()} onClick={() => void saveReview()}>
            Save hours review
          </button>
          <button
            type="button"
            onClick={() => {
              if (discard()) {
                setReview(null)
                setDirty(false)
              }
            }}
          >
            Close hours review
          </button>
        </fieldset>
      </CRMEditorDialog>}
    </section>
  )
}
