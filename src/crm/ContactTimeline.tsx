'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Read the explicitly selected authorized timeline page. */
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { ContactTimeline as TimelineService } from './timeline'
import { RecordAttachmentLink } from './RecordAttachmentLink'
import { RecordTaskLink } from './RecordTaskLink'
import { crmRecordTypes, type CRMRecordType } from './record-model'
import {
  timelineLabels,
  type TimelineEvent,
  type TimelineGroup,
  type TimelineCursor,
} from './timeline-model'

export type TimelineDestination =
  | 'profile'
  | 'chapter'
  | 'relationships'
  | 'communications'
  | 'gifts'
  | 'giving'
  | 'memberships'
  | 'opportunities'
  | 'volunteers'
  | 'correspondence'
  | 'attachments'
  | 'comments'
  | 'tasks'
type Props = {
  api: string
  site: string
  contact: string
  onOpen?: (tab: TimelineDestination) => void
  onSaving?: (busy: boolean) => void
  onDenied?: (message: string) => void
}
type Page = Awaited<ReturnType<TimelineService['list']>>
const destination = (row: TimelineEvent): TimelineDestination =>
  row.group === 'tasks'
    ? 'tasks'
    : row.group === 'giving'
      ? row.targetType === 'gift'
        ? 'gifts'
        : 'giving'
      : row.group
const amountLabels = {
  'received-gift': 'Recorded gift amount',
  'gift-adjustment': 'Adjustment amount',
  pledge: 'Commitment amount',
  'recurring-installment': 'Expected installment',
}

export function ContactTimeline(props: Props) {
  return <Timeline key={`${props.api}:${props.site}:${props.contact}`} {...props} />
}
function Timeline({ api, site, contact, onOpen, onSaving, onDenied }: Props) {
  const [page, setPage] = useState<Page | null>(null),
    [group, setGroup] = useState<TimelineGroup | ''>(''),
    [before, setBefore] = useState<TimelineCursor | null>(null),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [selected, setSelected] = useState<TimelineEvent | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const denied = useRef(onDenied)
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal()
  }, [selected])
  const closeDetail = () => {
    dialog.current?.close()
    setSelected(null)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  useEffect(() => {
    denied.current = onDenied
  }, [onDenied])
  useEffect(() => {
    onSaving?.(loading)
  }, [loading, onSaving])
  useEffect(() => {
    const controller = new AbortController(),
      query = new URLSearchParams({ site, contact, group })
    dialog.current?.close()
    setSelected(null)
    if (before) {
      query.set('beforeDate', before.date)
      query.set('beforeID', before.id)
      query.set('authorityRevision', String(before.revision))
    }
    setLoading(true)
    void crmRead<Page>(`${api}/crm/timeline?${query}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          if (group && !result.groups.includes(group)) {
            setGroup('')
            setBefore(null)
            setPage(null)
            return
          }
          setPage(result)
          setError('')
        }
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setPage(null)
        setError(cause.message)
        if (cause.status === 409 && before) {
          setBefore(null)
          return
        }
        if ([401, 403].includes(cause.status)) denied.current?.(cause.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, site, contact, group, before, refresh])
  useEffect(() => {
    const focus = () => {
      setBefore(null)
      setRefresh((v) => v + 1)
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  return (
    <section className="vc-crm-domain vc-crm-timeline" aria-label="Authorized contact timeline">
      <h2>Contact timeline</h2>
      <p>History from records you can access in this chapter.</p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading authorized history…</p>}
      <label>
        Timeline area
        <select
          value={group}
          disabled={loading}
          onChange={(event) => {
            setGroup(event.target.value as TimelineGroup | '')
            setBefore(null)
            setPage(null)
          }}
        >
          <option value="">All authorized areas</option>
          {group && !page?.groups.includes(group) && (
            <option value={group}>{timelineLabels[group]}</option>
          )}
          {page?.groups.map((value) => (
            <option key={value} value={value}>
              {timelineLabels[value]}
            </option>
          ))}
        </select>
      </label>
      {page && (
        <>
          <p>
            {page.total.toLocaleString()} authorized events. Showing {page.docs.length} on this
            page.
          </p>
          <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
            {page.docs.map((row) => (
              <li key={row.id}>
                <article aria-label={row.title}>
                  <h3>{row.title}</h3>
                  <p>Related record: {row.label}</p>
                  <p>
                    {row.at ? (
                      <time dateTime={row.at}>Recorded {new Date(row.at).toLocaleString()}</time>
                    ) : (
                      'Recorded date unavailable'
                    )}
                    {row.effectiveOn && <> · Effective date: {row.effectiveOn}</>}
                  </p>
                  <button type="button" className="vc-crm-read-more" disabled={loading}
                    onClick={(event) => { trigger.current = event.currentTarget; setSelected(row) }}>
                    Read more
                  </button>
                </article>
              </li>
            ))}
          </ol>
          {!page.docs.length && <p>No authorized events match this selection.</p>}
        </>
      )}
      <div className="vc-crm-toolbar">
        <button type="button" disabled={loading || !before} onClick={() => setBefore(null)}>
          First events
        </button>
        <button
          type="button"
          disabled={loading || !page?.next}
          onClick={() => setBefore(page!.next)}
        >
          Older events
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setBefore(null)
            setRefresh((v) => v + 1)
          }}
        >
          Refresh timeline
        </button>
      </div>
      {selected && <dialog ref={dialog} className="vc-crm-event-dialog"
        aria-labelledby="vc-crm-event-title" onClose={() => { setSelected(null); requestAnimationFrame(() => trigger.current?.focus()) }}>
        <h2 id="vc-crm-event-title">{selected.title}</h2>
        <dl>
          <div><dt>Related record</dt><dd>{selected.label}</dd></div>
          <div><dt>Recorded</dt><dd>{selected.at ? new Date(selected.at).toLocaleString() : 'Date unavailable'}</dd></div>
          {selected.effectiveOn && <div><dt>Effective date</dt><dd>{selected.effectiveOn}</dd></div>}
          {selected.amount && selected.moneyRole && <div><dt>{amountLabels[selected.moneyRole]}</dt><dd>{selected.amount}</dd></div>}
          {selected.detail && <div><dt>Details</dt><dd className="vc-crm-event-detail">{selected.detail}</dd></div>}
        </dl>
        <div className="vc-crm-event-actions">
          {selected.group === 'tasks' && <RecordTaskLink site={site} task={selected.targetID} />}
          {selected.group === 'attachments' && crmRecordTypes.includes(selected.targetType as CRMRecordType) &&
            <RecordAttachmentLink site={site} link={{ type: selected.targetType as CRMRecordType, id: selected.targetID }} />}
          <button type="button" onClick={closeDetail}>Close</button>
          {onOpen && <button type="button" className="vc-crm-primary" onClick={() => {
            const target = selected.group === 'profile' && selected.id.startsWith('affiliation:') ? 'chapter' : destination(selected)
            closeDetail()
            onOpen(target)
          }}>Open relevant section</button>}
        </div>
      </dialog>}
    </section>
  )
}
