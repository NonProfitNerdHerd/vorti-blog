'use client'
/* eslint-disable react-hooks/set-state-in-effect -- Load an explicit authorized event-history page. */
import { useEffect, useRef, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { EmailOutbox } from './email-outbox'
type History = Awaited<ReturnType<EmailOutbox['events']>>
type Props = {
  api: string
  site: string
  id: string
  refresh?: number
  onDenied?: (message: string) => void
}
export function EmailEventHistory(props: Props) {
  return <Events key={`${props.api}:${props.site}:${props.id}`} {...props} />
}
function Events({ api, site, id, refresh = 0, onDenied }: Props) {
  const denied = useRef(onDenied)
  useEffect(() => {
    denied.current = onDenied
  }, [onDenied])
  const [data, setData] = useState<History>({ docs: [], next: null }),
    [before, setBefore] = useState<{ date: string; id: string } | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void crmRead<History>(
      `${api}/crm/email-deliveries?${new URLSearchParams({ site, id, view: 'events', beforeDate: before?.date || '', beforeID: before?.id || '' })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result)
          setError('')
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setData({ docs: [], next: null })
          setError(cause.message)
          if ([401, 403].includes(cause.status)) denied.current?.(cause.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, site, id, before, refresh])
  return (
    <section aria-label="Email event history">
      <h4>Delivery history</h4>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading retained delivery events…</p>}
      <table>
        <thead>
          <tr>
            <th>Recorded</th>
            <th>Event</th>
            <th>Staff</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {data.docs.map((event) => (
            <tr key={event.id}>
              <td>{event.created_at}</td>
              <td>{event.event}</td>
              <td>{event.actor_id === null ? 'Service' : `Staff #${event.actor_id}`}</td>
              <td>
                {event.detail}
                {event.provider_id && <span> Provider message {event.provider_id}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && !data.docs.length && <p>No retained delivery events match this page.</p>}
      <button type="button" disabled={!before || loading} onClick={() => setBefore(null)}>
        Latest delivery events
      </button>
      <button type="button" disabled={!data.next || loading} onClick={() => setBefore(data.next)}>
        Older delivery events
      </button>
    </section>
  )
}
