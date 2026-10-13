'use client'
import { useEffect, useState } from 'react'
interface Metrics {
  views: number; starts: number; completed: number; completionRate: number | null; estimatedAbandonments: number; averageCompletionMs: number | null
  steps: { step: string; kind: string; events: number; sessions: number }[]
  failures: { field: string; events: number }[]
}
export function FormAnalytics({ formID, labels = {} }: { formID: string | number; labels?: Record<string, string> }) {
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }))
  const [query, setQuery] = useState(range), [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; metrics?: Metrics; error?: string }>()
  const key = `${formID}:${query.from}:${query.to}:${retry}`
  useEffect(() => {
    const controller = new AbortController(), params = new URLSearchParams({ from: `${query.from}T00:00:00.000Z`, to: new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 86400000).toISOString() })
    fetch(`/api/forms-analytics/${encodeURIComponent(formID)}?${params}`, { signal: controller.signal }).then(async response => {
      const data = await response.json() as Metrics & { message?: string }
      if (!response.ok) throw new Error(data.message || 'Analytics could not be loaded.')
      setResult({ key, metrics: data })
    }).catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message }) })
    return () => controller.abort()
  }, [formID, query, key])
  const metrics = result?.key === key ? result.metrics : undefined
  return <section aria-label="Form analytics" className="forms-analytics">
    <h2>Form analytics</h2><p>Measures opted-in activity when consent is required. Dates use UTC. No answers, filenames, signatures or resume links are collected.</p>
    <div className="forms-builder-actions"><label>From<input type="date" value={range.from} onChange={event => setRange({ ...range, from: event.target.value })} /></label><label>Through<input type="date" value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} /></label><button type="button" disabled={!range.from || !range.to || range.to < range.from} onClick={() => { setQuery(range); setRetry(n => n + 1) }}>Update report</button></div>
    {result?.key === key && result.error ? <p role="alert">{result.error}</p> : !metrics ? <p role="status">Loading measurements…</p> : <>
      <dl className="forms-analytics-totals">{[
        ['Viewed sessions', metrics.views], ['Started sessions', metrics.starts], ['Accepted sessions', metrics.completed],
        ['Completion rate', metrics.completionRate === null ? 'No starts in this period' : `${(metrics.completionRate * 100).toFixed(1)}%`],
        ['Estimated abandonments', metrics.estimatedAbandonments], ['Average time to acceptance', metrics.averageCompletionMs === null ? 'Not measured' : `${Math.round(metrics.averageCompletionMs / 1000)} seconds`],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p>Views and starts count once per form session and revision. Acceptance is recorded by the server. Abandonment is an estimate: started sessions without a matching acceptance in this date range; some visitors may finish later. Completion rate measures starts and matching acceptances within this period. Date boundaries can separate a start from its completion.</p>
      <h3>Steps and exits</h3><p>Exits are observed navigation or page departures, not proof of abandonment. Browsers may not deliver departure events.</p>
      {metrics.steps.length ? <table><thead><tr><th>Step</th><th>Event</th><th>Occurrences</th><th>Sessions</th></tr></thead><tbody>{metrics.steps.map(row => <tr key={`${row.step}:${row.kind}`}><td>{labels[row.step] || row.step}</td><td>{row.kind === 'step' ? 'Entered' : row.kind}</td><td>{row.events}</td><td>{row.sessions}</td></tr>)}</tbody></table> : <p>No step activity in this period.</p>}
      <h3>Validation errors</h3>{metrics.failures.length ? <ul>{metrics.failures.map(row => <li key={row.field}>{labels[row.field] || row.field}: {row.events}</li>)}</ul> : <p>No measured validation errors.</p>}
    </>}
  </section>
}
