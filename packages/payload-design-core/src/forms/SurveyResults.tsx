'use client'
import { useEffect, useState } from 'react'
import type { SurveyFieldSummary } from './survey'
import './forms.css'
interface SurveyResponse { fields?: SurveyFieldSummary[]; message?: string; entries?: number }

export function SurveyResults({ endpoint }: { endpoint: string }) {
  const [result, setResult] = useState<{ endpoint: string; fields?: SurveyFieldSummary[]; message?: string; entries?: number; error?: string }>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch(endpoint, { signal: controller.signal }).then(async response => {
      const data = await response.json() as SurveyResponse
      if (!response.ok) throw new Error(data.message || 'Could not load results.')
      if (!controller.signal.aborted) setResult({ endpoint, ...data })
    }).catch(error => { if (!controller.signal.aborted) setResult({ endpoint, error: error.message }) })
    return () => controller.abort()
  }, [endpoint, retry])
  const current = result?.endpoint === endpoint ? result : undefined
  return <section aria-label="Survey results" className="forms-survey">
    <h3>Survey results</h3>
    <p>Sensitive fields and free-text answers are excluded. Repeated fields count individual items, not people. Percentages use answered responses; multiple choices may exceed 100%.</p>
    {!current ? <p role="status">Loading results…</p> : current.error ? <p role="alert">{current.error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry results</button></p> : <>
      {current.message && <p role="status">{current.message}</p>}
      {current.entries !== undefined && <p>{current.entries} entries in this revision and date range.</p>}
      {!current.message && !current.fields?.length && <p>No supported survey fields have reportable responses.</p>}
      {current.fields?.map(field => <section key={field.id}>
        <h4>{field.label}{field.repeated ? ' (repeated items)' : ''}</h4>
        <p>{field.responses} answers{field.mean !== undefined ? ` · Mean ${field.mean.toFixed(2)}` : ''}{field.nps !== undefined ? ` · NPS ${field.nps.toFixed(1)}` : ''}</p>
        {(field.rows || [{ id: field.id, label: field.label, responses: field.responses, buckets: field.buckets }]).map(row => <table key={row.id}>
          <caption>{row.label}</caption><thead><tr><th scope="col">Answer</th><th scope="col">Count</th><th scope="col">Percent</th>{field.kind === 'ranking' && <th scope="col">Mean rank (1 is first)</th>}</tr></thead>
          <tbody>{row.buckets.map(bucket => <tr key={bucket.id}><th scope="row">{bucket.label}</th><td>{bucket.count}</td><td>{row.responses ? (100 * bucket.count / row.responses).toFixed(1) : '0'}%</td>{field.kind === 'ranking' && <td>{bucket.count ? ((bucket.rankTotal || 0) / bucket.count).toFixed(2) : '—'}</td>}</tr>)}</tbody>
        </table>)}
      </section>)}
    </>}
  </section>
}
