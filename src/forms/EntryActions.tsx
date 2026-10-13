'use client'
import { useEffect, useState } from 'react'

type Delivery = { id: number; label: string; kind: string; status: string; attempts: number; attemptLog?: { message?: string; error?: string }[] }
export function EntryActions({ id }: { id: number | string }) {
  const [actions, setActions] = useState<Delivery[]>([])
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ 'where[submissionID][equals]': String(id), limit: '100', depth: '0' })
    fetch(`/api/form-outbox?${query}`, { signal: controller.signal }).then(async response => {
      if (response.status === 403) return
      if (!response.ok) throw new Error('Action status could not be loaded.')
      const result = await response.json() as { docs: Delivery[] }
      setActions(result.docs)
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message) })
    return () => controller.abort()
  }, [id, version])
  async function retry(action: Delivery) {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/forms-actions/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replay: action.id }) })
      if (!response.ok) throw new Error('The action could not be retried. Check the connection configuration and your access.')
      setMessage('Retry processed. Check the updated status below.'); setVersion(value => value + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Retry failed.') }
    finally { setBusy(false) }
  }
  if (!actions.length && !message) return null
  return <section aria-label="Submission actions"><h2>Notifications and actions</h2>
    <p>Entries are saved independently of delivery. Failed or unconfigured actions can be retried after fixing their connection. Temporary failures retry automatically.</p>
    {message && <p role="status">{message}</p>}
    <ul>{actions.map(action => <li key={action.id}><strong>{action.label || action.kind}</strong>: {action.status} · {action.attempts || 0} attempts
      {['failed', 'unconfigured'].includes(action.status) && <button type="button" disabled={busy} onClick={() => void retry(action)}>Retry {action.kind}</button>}
    </li>)}</ul>
  </section>
}
