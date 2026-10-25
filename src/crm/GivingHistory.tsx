'use client'
import { useEffect, useState } from 'react'
import { crmRead } from './HouseholdWorkspace'
import type { CommitmentRepository } from './commitments'

type History = Awaited<ReturnType<CommitmentRepository['history']>>
const labels: Record<string, string> = {
  'giving.created': 'Giving record created',
  'giving.payment-applied': 'Payment applied',
  'giving.payment-reversed': 'Payment application reversed',
  pause: 'Schedule paused',
  resume: 'Schedule resumed',
  cancel: 'Commitment cancelled',
  rename: 'Record renamed',
}
export function GivingHistory(props: { api: string; site: string; id: string; revision: number }) {
  return <HistoryPage key={`${props.site}:${props.id}:${props.revision}`} {...props} />
}
function HistoryPage({ api, site, id }: Parameters<typeof GivingHistory>[0]) {
  const [cursor, setCursor] = useState<History['next']>(null)
  const [data, setData] = useState<History | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const focus = () => setRefresh((value) => value + 1)
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear prior private history before resolving this explicitly scoped page.
    setData(null)
    setLoading(true)
    setError('')
    void crmRead<History>(
      `${api}/crm/giving?${new URLSearchParams({ site, id, view: 'history', ...(cursor ? { afterID: cursor.id, afterCreatedAt: cursor.createdAt } : {}) })}`,
      { signal: controller.signal },
    )
      .then((page) => {
        if (!controller.signal.aborted) setData(page)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, site, id, cursor, refresh])
  return (
    <section aria-label="Giving change history">
      <h4>Change history</h4>
      <p>
        Recorded staff changes and payment applications. Source gifts retain their separate
        financial history.
      </p>
      <button type="button" onClick={() => setRefresh((value) => value + 1)}>
        Refresh change history
      </button>
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading change history…</p>
      ) : (
        <>
          {data?.docs.length ? (
            <ol>
              {data.docs.map((event) => (
                <li key={event.id}>
                  <strong>{labels[event.change || event.action] || 'Giving record changed'}</strong>
                  <p>
                    <time dateTime={event.createdAt}>{event.createdAt}</time> · {event.actorLabel}
                  </p>
                  {event.effectiveOn && <p>Effective {event.effectiveOn}</p>}
                  {event.change === 'rename' && event.name && <p>New name: {event.name}</p>}
                  {event.reason && <p style={{ whiteSpace: 'pre-wrap' }}>{event.reason}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p>No recorded changes.</p>
          )}
        </>
      )}
      <button type="button" disabled={loading || !cursor} onClick={() => setCursor(null)}>
        Latest changes
      </button>
      <button type="button" disabled={loading || !data?.next} onClick={() => setCursor(data!.next)}>
        Older changes
      </button>
    </section>
  )
}
