import type { Endpoint, Payload } from 'payload'
import type { FormField } from '@design-system/payload-design-core/forms'
import { canForm, FORM_INTERNAL, type FormsUser } from './access'
import type { FormPlatform } from './platform'
import { csvDocument, exportFields, exportMetadata, exportRow, xlsxDocument, type ExportEntry, type SpreadsheetCell } from './export-format'
import { readBoundedJSON, randomToken, FormHTTPError } from './security'

interface ExportFilters { formID: number; from: string; to: string; maxID: number; status?: string; sensitive: boolean; worker?: string }
interface ExportJob { id: number; site: string; requested_by: string; status: string; format: 'csv' | 'xlsx'; columns: string; filters: string; object_key?: string; expires_at?: string; error?: string }
const mime = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
const noStore = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }

export async function generateExport(platform: FormPlatform, payload: Payload, site: string, id: number): Promise<void> {
  const worker = randomToken(), now = new Date().toISOString()
  const job = await platform.db.prepare("UPDATE form_exports SET status='running', filters=json_set(filters,'$.worker',?), updated_at=? WHERE id=? AND site=? AND (status='pending' OR (status='running' AND updated_at<?)) RETURNING *").bind(worker, now, id, site, new Date(Date.now() - 60000).toISOString()).first<ExportJob>()
  if (!job) {
    const current = await platform.db.prepare('SELECT status FROM form_exports WHERE id=? AND site=?').bind(id, site).first<{ status: string }>()
    if (current?.status === 'complete' || current?.status === 'failed') return
    throw new Error('Export is already being processed or unavailable.')
  }
  const filters = JSON.parse(job.filters) as ExportFilters, columns = JSON.parse(job.columns) as string[]
  let objectKey: string | undefined
  try {
    const requester = await payload.findByID({ collection: 'users', id: job.requested_by, overrideAccess: true, depth: 0 }) as FormsUser
    if (!canForm(requester, 'export', site) || !canForm(requester, 'entries', site) || (filters.sensitive && !canForm(requester, 'sensitive', site))) throw new FormHTTPError('Export permissions changed. Ask an administrator to review access.', 403)
    const rows: SpreadsheetCell[][] = [columns], maxRows = platform.exportLimits?.rows || 5000, maxBytes = platform.exportLimits?.bytes || 8 * 1024 * 1024
    let cursor = 0, bytes = 0
    while (cursor < filters.maxID) {
      const entries = await platform.db.prepare(`SELECT id, answers, schema_snapshot, revision, workflow_status, created_at FROM form_submissions WHERE site=? AND form_id=? AND id>? AND id<=? AND created_at>=? AND created_at<?${filters.status ? ' AND workflow_status=?' : ''} ORDER BY id LIMIT 100`).bind(site, filters.formID, cursor, filters.maxID, filters.from, filters.to, ...(filters.status ? [filters.status] : [])).all<ExportEntry>()
      if (!entries.results.length) break
      for (const entry of entries.results) {
        const row = exportRow(entry, columns, filters.sensitive)
        bytes += new TextEncoder().encode(JSON.stringify(row)).length
        if (rows.length > maxRows || bytes > maxBytes) throw new FormHTTPError('This export exceeds the configured size limit. Select a shorter date range or fewer columns.')
        rows.push(row); cursor = entry.id
      }
      const renewed = await platform.db.prepare("UPDATE form_exports SET updated_at=? WHERE id=? AND site=? AND status='running' AND json_extract(filters,'$.worker')=?").bind(new Date().toISOString(), id, site, worker).run()
      if (renewed.meta.changes !== 1) throw new Error('Export claim expired.')
    }
    const bytesOut = job.format === 'xlsx' ? xlsxDocument(rows) : csvDocument(rows)
    objectKey = `form-private/${site}/exports/${id}/${worker}.${job.format}`
    await platform.storage.put(objectKey, bytesOut, { httpMetadata: { contentType: mime[job.format] } })
    const completed = await platform.db.prepare("UPDATE form_exports SET status='complete', object_key=?, expires_at=?, error=NULL, updated_at=? WHERE id=? AND site=? AND status='running' AND json_extract(filters,'$.worker')=?").bind(objectKey, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString(), id, site, worker).run()
    if (completed.meta.changes !== 1) await platform.storage.delete(objectKey)
  } catch (error) {
    if (objectKey) await platform.storage.delete(objectKey).catch(() => {})
    const message = error instanceof FormHTTPError || (error instanceof Error && error.message.includes('XLSX cell limit')) ? (error as Error).message : 'Export generation failed. Request a new export after checking storage and access.'
    await platform.db.prepare("UPDATE form_exports SET status='failed', error=?, updated_at=? WHERE id=? AND site=? AND json_extract(filters,'$.worker')=?").bind(message, new Date().toISOString(), id, site, worker).run()
  }
}

export function formExportEndpoints(platform: FormPlatform): Endpoint[] {
  return [{ path: '/forms-exports/:formID', method: 'post', handler: async req => {
    try {
      if (!req.user || req.headers.get('origin') !== new URL(req.url!).origin) throw new FormHTTPError('An authenticated same-origin request is required.', 403)
      const form = await platform.db.prepare('SELECT id, site, title FROM forms WHERE id=?').bind(String(req.routeParams?.formID || '')).first<{ id: number; site: string; title: string }>()
      if (!form || !canForm(req.user as FormsUser, 'export', form.site) || !canForm(req.user as FormsUser, 'entries', form.site)) throw new FormHTTPError('Export access is required.', 403)
      const body = await readBoundedJSON(req, 16000)
      if (!['csv', 'xlsx'].includes(String(body.format))) throw new FormHTTPError('Choose CSV or XLSX.')
      const from = new Date(String(body.from || '')), to = new Date(String(body.to || ''))
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new FormHTTPError('Choose valid From and Through dates.')
      if (body.status && !['received', 'in-review', 'approved', 'rejected', 'completed'].includes(String(body.status))) throw new FormHTTPError('Choose a valid workflow status.')
      const selected = body.columns
      if (!Array.isArray(selected) || selected.length > 150 || selected.some(column => typeof column !== 'string' || (!exportMetadata.includes(column as typeof exportMetadata[number]) && !/^field:[a-zA-Z0-9_-]+$/.test(column)))) throw new FormHTTPError('Choose valid export columns.')
      const columns = [...new Set([...exportMetadata, ...selected])]
      const sensitive = body.sensitive === true
      if (sensitive && !canForm(req.user as FormsUser, 'sensitive', form.site)) throw new FormHTTPError('Sensitive-entry access is required.', 403)
      const ceiling = await platform.db.prepare('SELECT MAX(id) AS id FROM form_submissions WHERE site=? AND form_id=?').bind(form.site, form.id).first<{ id: number }>()
      const filters: ExportFilters = { formID: form.id, from: from.toISOString(), to: to.toISOString(), maxID: ceiling?.id || 0, status: body.status ? String(body.status) : undefined, sensitive }
      const context = { ...req.context, [FORM_INTERNAL]: true }
      const record = await req.payload.create({ collection: 'form-exports', overrideAccess: true, req, context,
        data: { label: `${form.title} · ${String(body.format).toUpperCase()}`, site: form.site, requestedBy: String(req.user.id), status: 'pending', format: String(body.format), columns, filters: { ...filters } } })
      const action = { id: `export-${record.id}`, kind: 'form-export', name: 'Generate entries export', config: { exportID: record.id } }
      await platform.db.prepare("INSERT OR IGNORE INTO form_outbox (label,site,event_i_d,kind,status,payload,attempts,next_attempt_at) VALUES (?,?,?,'form-export','pending',?,0,?)").bind(action.name, form.site, action.id, JSON.stringify({ action }), new Date().toISOString()).run()
      platform.defer?.(() => generateExport(platform, req.payload, form.site, record.id))
      return Response.json({ id: record.id, status: 'pending', format: body.format }, { status: 202, headers: noStore })
    } catch (error) { return Response.json({ message: error instanceof FormHTTPError ? error.message : 'Could not queue this export.' }, { status: error instanceof FormHTTPError ? error.status : 500, headers: noStore }) }
  } }, { path: '/forms-exports/job/:id', method: 'get', handler: async req => {
    const job = await platform.db.prepare('SELECT * FROM form_exports WHERE id=?').bind(String(req.routeParams?.id || '')).first<ExportJob>()
    const user = req.user as FormsUser | undefined
    if (!job || !user || job.requested_by !== String(user.id) || !canForm(user, 'export', job.site) || !canForm(user, 'entries', job.site)) return Response.json({ message: 'Export not found.' }, { status: 404, headers: noStore })
    const filters = JSON.parse(job.filters) as ExportFilters
    if (filters.sensitive && !canForm(user, 'sensitive', job.site)) return Response.json({ message: 'Sensitive-entry access is required.' }, { status: 403, headers: noStore })
    if (!new URL(req.url!).searchParams.has('download')) return Response.json({ id: job.id, status: job.status, error: job.error, expiresAt: job.expires_at, format: job.format }, { headers: noStore })
    const expiry = Date.parse(job.expires_at || '')
    if (job.status !== 'complete' || !job.object_key?.startsWith(`form-private/${job.site}/exports/`) || !Number.isFinite(expiry) || expiry <= Date.now()) return Response.json({ message: 'This export is not ready or has expired. Request another export.' }, { status: 409, headers: noStore })
    const file = await platform.storage.get(job.object_key)
    if (!file) return Response.json({ message: 'Export no longer available.' }, { status: 410, headers: noStore })
    return new Response(file.body, { headers: { ...noStore, 'Content-Type': mime[job.format], 'Content-Disposition': `attachment; filename="form-entries-${job.id}.${job.format}"`, 'X-Content-Type-Options': 'nosniff' } })
  } }, { path: '/forms-exports/:formID/columns', method: 'get', handler: async req => {
    const form = await platform.db.prepare('SELECT id,site FROM forms WHERE id=?').bind(String(req.routeParams?.formID || '')).first<{ id: number; site: string }>()
    if (!form || !canForm(req.user as FormsUser, 'export', form.site) || !canForm(req.user as FormsUser, 'entries', form.site)) return Response.json({ message: 'Export access is required.' }, { status: 403, headers: noStore })
    const revisions = await platform.db.prepare('SELECT definition FROM form_revisions WHERE site=? AND form_id=? ORDER BY id').bind(form.site, form.id).all<{ definition: string }>()
    const fields = new Map<string, string>()
    for (const revision of revisions.results) for (const field of exportFields((JSON.parse(revision.definition) as { fields: FormField[] }).fields)) if (!field.sensitive || canForm(req.user as FormsUser, 'sensitive', form.site)) fields.set(field.id, field.label)
    return Response.json({ columns: [...fields].map(([id, label]) => ({ id: `field:${id}`, label })), sensitive: canForm(req.user as FormsUser, 'sensitive', form.site) }, { headers: noStore })
  } }]
}
