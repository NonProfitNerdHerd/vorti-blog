'use client'
import { useDocumentInfo, useField } from '@payloadcms/ui'
import type { JSONFieldClientComponent } from 'payload'
import { paymentCurrencies, type Answers, type FormField, type PaymentView } from '@design-system/payload-design-core/forms'
import { SubmissionSummary } from '@design-system/payload-design-core/forms/client'
import { useEffect, useState } from 'react'
import { EntryActions } from './EntryActions'

interface AuditItem { id: number; createdAt: string; actorID: string; action: string; changes?: Record<string, { before: unknown; after: unknown }> }
export const EntryDetails: JSONFieldClientComponent = ({ path }) => {
  const { value } = useField<Answers>({ path })
  const { value: snapshot } = useField<{ title: string; fields: FormField[] }>({ path: 'schemaSnapshot' })
  const { id, data } = useDocumentInfo()
  const [history, setHistory] = useState<{ id: string; items: AuditItem[]; error?: string }>()
  const [payment, setPayment] = useState<{ id: string; value?: PaymentView & { reference?: string; updatedAt: string }; error?: string }>()
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    fetch(`/api/forms-payments/entry/${id}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Payment details could not be loaded.')
      const result = await response.json() as { payment?: PaymentView & { reference?: string; updatedAt: string } }
      setPayment({ id: String(id), value: result.payment || undefined })
    }).catch(error => { if (!controller.signal.aborted) setPayment({ id: String(id), error: String(error.message) }) })
    const query = new URLSearchParams({ 'where[submissionID][equals]': String(id), sort: '-createdAt', limit: '100', depth: '0' })
    fetch(`/api/form-audit?${query}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Review history could not be loaded.')
      const result = await response.json() as { docs: AuditItem[] }
      setHistory({ id: String(id), items: result.docs })
    }).catch(error => { if (!controller.signal.aborted) setHistory({ id: String(id), items: [], error: String(error.message) }) })
    return () => controller.abort()
  }, [id, data?.updatedAt])
  if (!snapshot?.fields) return <p>This historical entry uses the original submission fields below.</p>
  return <section aria-label="Submitted answers">
    <p><a href={`/api/forms-receipts/${id}`} target="_blank" rel="noopener noreferrer">Print / save receipt as PDF</a></p>
    <h2>{snapshot.title || 'Submitted answers'}</h2>
    <p>Original answers are preserved. Review notes and workflow changes are recorded separately.</p>
    {id && <EntryActions id={id} />}
    {payment?.id === String(id) && (payment.error ? <p role="alert">{payment.error}</p> : payment.value && <section aria-label="Payment details"><h3>Payment</h3>
      <p>{payment.value.simulated ? 'Local simulator — no real transaction' : 'Stripe test mode'} · {payment.value.status}</p>
      <p>Amount: {new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.value.currency }).format(payment.value.amount / 10 ** paymentCurrencies[payment.value.currency])}</p>
      {payment.value.refundedAmount > 0 && <p>Refunded: {new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.value.currency }).format(payment.value.refundedAmount / 10 ** paymentCurrencies[payment.value.currency])}</p>}
      {payment.value.reference && <p>Checkout reference: {payment.value.reference}</p>}
      <p>Updated <time dateTime={payment.value.updatedAt}>{new Date(payment.value.updatedAt).toLocaleString()}</time></p>
    </section>)}
    <SubmissionSummary fields={snapshot.fields} answers={value || {}} attachment={attachmentID => <a href={`/api/forms-files/${encodeURIComponent(attachmentID)}`}>Download attachment {attachmentID}</a>} />
    <section aria-label="Review history"><h2>Review history</h2>
      {history?.id !== String(id) ? <p>Loading history…</p> : history.error ? <p role="alert">{history.error}</p> : history.items.length ? <ol>{history.items.map(item => <li key={item.id}>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time> · User {item.actorID || 'system'}
        <ul>{Object.entries(item.changes || {}).map(([key, change]) => <li key={key}><strong>{key}</strong>: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}</li>)}</ul>
      </li>)}</ol> : <p>No review changes yet.</p>}
    </section>
  </section>
}
