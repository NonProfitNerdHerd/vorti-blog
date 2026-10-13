'use client'
import { useEffect, useState } from 'react'
interface ExportState { id: number; status: string; error?: string; expiresAt?: string; format?: string }
export function FormExportPanel({ formID }: { formID: string | number }) {
  const [columns, setColumns] = useState<{ id: string; label: string }[]>([]), [selected, setSelected] = useState<string[]>([])
  const [canSensitive, setCanSensitive] = useState(false), [sensitive, setSensitive] = useState(false)
  const [format, setFormat] = useState('csv'), [status, setStatus] = useState('')
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }))
  const [job, setJob] = useState<ExportState>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/forms-exports/${formID}/columns`, { signal: controller.signal }).then(async response => {
      const data = await response.json() as { message?: string; columns: { id: string; label: string }[]; sensitive: boolean }
      if (!response.ok) throw new Error(data.message || 'Export columns could not be loaded.')
      setColumns(data.columns); setSelected(data.columns.map(column => column.id)); setCanSensitive(data.sensitive)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [formID])
  const jobID = job?.id, working = job?.status === 'pending' || job?.status === 'running'
  useEffect(() => {
    if (!jobID || !working) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await fetch(`/api/forms-exports/job/${jobID}`, { signal: controller.signal })
        const result = await response.json() as ExportState & { message?: string }
        if (!response.ok) throw new Error(result.message || 'Could not check export progress.')
        setJob(result)
        if (result.status === 'pending' || result.status === 'running') timer = setTimeout(() => void poll(), 1500)
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message) }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [jobID, working])
  const request = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/forms-exports/${formID}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        format, columns: selected, status: status || undefined, sensitive,
        from: `${range.from}T00:00:00.000Z`, to: new Date(Date.parse(`${range.to}T00:00:00.000Z`) + 86400000).toISOString(),
      }) })
      const result = await response.json() as ExportState & { message?: string }
      if (!response.ok) throw new Error(result.message || 'Could not request this export.')
      setJob(result)
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <section aria-label="Export entries" className="forms-analytics"><h2>Export entries</h2>
    <p>Downloads use original submitted answers and historical field labels. Entry ID, revision, submission time, workflow status, and field-label metadata are always included. Repeated and compound values remain structured JSON within cells.</p>
    <div className="forms-builder-actions"><label>Export from<input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></label><label>Export through<input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></label>
      <label>File format<select aria-label="File format" value={format} onChange={e => setFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></select></label>
      <label>Entry status<select aria-label="Entry status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['received', 'in-review', 'approved', 'rejected', 'completed'].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <fieldset><legend>Answer columns</legend>{columns.map(column => <label className="forms-builder-check" key={column.id}><input type="checkbox" checked={selected.includes(column.id)} onChange={e => setSelected(old => e.target.checked ? [...old, column.id] : old.filter(id => id !== column.id))} />{column.label} <small>({column.id.slice(6)})</small></label>)}</fieldset>
    {canSensitive && <label className="forms-builder-check"><input type="checkbox" checked={sensitive} onChange={e => setSensitive(e.target.checked)} />Include sensitive answers in this private download</label>}
    <button type="button" disabled={busy || working || !range.from || !range.to || range.to < range.from} onClick={() => void request()}>{busy ? 'Queuing…' : 'Generate export'}</button>
    {error && <p role="alert">{error}</p>}{job && <p role="status">Export {job.id}: {job.status}{job.error ? ` — ${job.error}` : ''}</p>}
    {job?.status === 'complete' && <p><a href={`/api/forms-exports/job/${job.id}?download=1`}>Download {(job.format || format).toUpperCase()} export</a> · Private download expires after 24 hours.</p>}
    <p>Generation runs in the background. Large exports are bounded by the configured row and byte limits; select a shorter date range if necessary. Existing jobs are listed under Forms → Form exports.</p>
  </section>
}
