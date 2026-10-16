'use client'
import { useEffect, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import { SurveyResults } from '@design-system/payload-design-core/forms/client'
import { FormExportPanel } from './FormExportPanel'

interface Entry { id: number; revision?: string; createdAt: string; workflowStatus?: string; answers?: Record<string, unknown>; schemaSnapshot?: { fields?: { id: string; label: string }[] } }
interface Entries { docs: Entry[]; totalDocs: number; totalPages: number }

export function FormSurvey({ formID, publishedRevision, canExport = false }: { formID: string | number; publishedRevision?: string; canExport?: boolean }) {
  const { config } = useConfig()
  const [filters, setFilters] = useState({ revision: '', from: '', to: '' })
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: string; entries?: Entries; error?: string }>()
  const [exportOpen, setExportOpen] = useState(false), [exportVisited, setExportVisited] = useState(false)
  const key = `${formID}:${publishedRevision}:${query}:${page}:${refresh}`
  const entries = result?.key === key ? result.entries : undefined
  const error = result?.key === key ? result.error : undefined
  useEffect(() => {
    const controller = new AbortController()
    const applied = new URLSearchParams(query)
    const params = new URLSearchParams({ limit: '20', page: String(page), depth: '0', sort: '-createdAt', 'where[form][equals]': String(formID) })
    const revision = applied.get('revision') || publishedRevision
    if (revision) params.set('where[revision][equals]', revision)
    if (applied.get('from')) params.set('where[createdAt][greater_than_equal]', applied.get('from')!)
    if (applied.get('to')) params.set('where[createdAt][less_than]', applied.get('to')!)
    fetch(`${config.routes.api}/form-submissions?${params}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Entries could not be loaded. Try updating the report again.')
      setResult({ key, entries: await response.json() as Entries })
    }).catch(error => { if (!controller.signal.aborted) setResult({ key, error: error.message }) })
    return () => controller.abort()
  }, [formID, publishedRevision, query, page, key, config.routes.api])
  return <section aria-label="Survey reporting">
    <div className="form-results-header"><div><h2>Results</h2><p>Browse submitted entries and open a response to see its full details.</p></div>{canExport && <button type="button" aria-expanded={exportOpen} aria-controls="form-results-export" onClick={() => { setExportOpen(open => !open); setExportVisited(true) }}>Export entries</button>}</div>
    <div id="form-results-export" hidden={!exportOpen}>{exportVisited && canExport && <FormExportPanel formID={formID} />}</div>
    <p>Defaults to the current published revision. Enter a historical revision ID from Entries to report it separately. Date filters use UTC.</p>
    <div className="form-results-filters">
      <label>Revision (optional)<input value={filters.revision} onChange={e => setFilters({ ...filters, revision: e.target.value })} /></label>
      <label>From<input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
      <label>Through<input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
      <button type="button" disabled={Boolean(filters.from && filters.to && filters.to < filters.from)} onClick={() => {
        const params = new URLSearchParams()
        if (filters.revision.trim()) params.set('revision', filters.revision.trim())
        if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`)
        if (filters.to) params.set('to', new Date(Date.parse(`${filters.to}T00:00:00.000Z`) + 86400000).toISOString())
        setQuery(params.toString()); setPage(1); setRefresh(value => value + 1)
      }}>Update survey report</button>
    </div>
    {filters.from && filters.to && filters.to < filters.from && <p role="alert">Through must be on or after From.</p>}
    {error ? <p role="alert">{error}</p> : !entries ? <p role="status">Loading entries…</p> : <>
      <p role="status">{entries.totalDocs} {entries.totalDocs === 1 ? 'entry' : 'entries'}</p>
      <div className="form-results-table"><table><caption className="sr-only">Form entries</caption><thead><tr><th scope="col">Entry</th><th scope="col">Submitted (UTC)</th><th scope="col">Revision</th><th scope="col">Status</th><th scope="col">Answers</th></tr></thead>
        <tbody>{entries.docs.map(entry => <tr key={entry.id}>
          <td><a href={`${config.routes.admin}/collections/form-submissions/${entry.id}`} target="_blank" rel="noopener noreferrer">Entry #{entry.id}<span className="sr-only"> (opens in a new tab)</span></a></td>
          <td>{new Date(entry.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</td><td title={entry.revision}>{entry.revision?.slice(0, 8) || 'Legacy'}</td><td>{entry.workflowStatus || 'received'}</td>
          <td>{Object.entries(entry.answers || {}).slice(0, 3).map(([key, value]) => <div key={key}><strong>{entry.schemaSnapshot?.fields?.find(field => field.id === key)?.label || key}: </strong>{typeof value === 'object' && value !== null ? 'Structured response — open entry' : String(value ?? '').slice(0, 120)}</div>)}</td>
        </tr>)}{!entries.docs.length && <tr><td colSpan={5}>No entries match this report. Try another revision or date range.</td></tr>}</tbody>
      </table></div>
      <nav aria-label="Results pages" className="form-results-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {Math.max(1, entries.totalPages)}</span><button type="button" disabled={page >= entries.totalPages} onClick={() => setPage(value => value + 1)}>Next</button></nav>
    </>}
    {publishedRevision && <details className="form-results-summary"><summary>Survey summary</summary><SurveyResults key={refresh} endpoint={`/api/forms-surveys/${encodeURIComponent(formID)}?${query}`} /></details>}
  </section>
}
