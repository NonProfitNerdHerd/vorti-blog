import { scopeImportRun } from './import-access'
import { scopeImportExport } from './import-exports'
import { SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { CRMJobs } from './jobs'

export async function listImportExports(
  db: D1Database,
  actor: number,
  siteID: string,
  runID: string,
  after = '',
) {
  const { run, site } = await scopeImportRun(db, actor, siteID, runID)
  if (after.length > 80) throw Error('Choose a valid result file page.')
  const rows = await db
    .prepare(
      `SELECT e.id,e.created_at,e.expires_at,e.errors_only,e.expected_rows,e.run_revision,e.run_updated_at,e.authority_revision,
    j.status,j.progress,j.fence,j.error,f.bytes FROM vc_crm_import_exports e JOIN vc_crm_jobs j ON j.id=e.job_id
    LEFT JOIN vc_crm_import_export_files f ON f.export_id=e.id WHERE e.run_id=? AND e.id>? ORDER BY e.id LIMIT 26`,
    )
    .bind(runID, after)
    .all<{
      id: string
      created_at: string
      expires_at: string
      errors_only: number
      expected_rows: number
      run_revision: number
      run_updated_at: string
      authority_revision: number
      status: string
      progress: number
      fence: number
      error: string | null
      bytes: number | null
    }>()
  const current = await scopeImportRun(db, actor, siteID, runID)
  if (
    current.site.authorityRevision !== site.authorityRevision ||
    current.run.revision !== run.revision
  )
    throw new SiteConflictError()
  const docs = rows.results.slice(0, 25).map((row) => {
    const expired = row.expires_at <= new Date().toISOString(),
      stale =
        row.run_revision !== run.revision ||
        row.run_updated_at !== run.updated_at ||
        row.authority_revision !== site.authorityRevision
    return {
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      errorsOnly: !!row.errors_only,
      rows: row.expected_rows,
      status: row.status,
      progress: row.progress,
      fence: row.fence,
      error: row.error,
      bytes: row.bytes,
      expired,
      stale,
      downloadable: !expired && !stale && row.status === 'completed' && row.bytes !== null,
    }
  })
  return { docs, next: rows.results.length > 25 ? docs.at(-1)!.id : null }
}

export async function controlImportExport(
  db: D1Database,
  actor: number,
  input: {
    site: string
    id: string
    export: string
    expectedRevision: number
    expectedFence: number
    operationKey: string
    action: 'cancel-results' | 'retry-results' | 'wake-results'
  },
) {
  const { run } = await scopeImportRun(db, actor, input.site, input.id)
  if (run.revision !== input.expectedRevision) throw new SiteConflictError()
  const file = await db
    .prepare('SELECT job_id FROM vc_crm_import_exports WHERE id=? AND run_id=?')
    .bind(input.export, input.id)
    .first<{ job_id: string }>()
  if (!file) throw new SiteAccessError()
  const jobs = new CRMJobs(db)
  let result: Record<string, unknown>
  if (input.action === 'cancel-results')
    result = await jobs.cancel(
      actor,
      input.site,
      file.job_id,
      input.operationKey,
      input.expectedFence,
    )
  else {
    await scopeImportExport(db, actor, input.site, input.export)
    if (input.action === 'retry-results')
      result = await jobs.retry(
        actor,
        input.site,
        file.job_id,
        input.expectedFence,
        input.operationKey,
      )
    else {
      const job = await db
        .prepare(
          "SELECT 1 FROM vc_crm_jobs WHERE id=? AND actor_id=? AND fence=? AND status IN('pending','running')",
        )
        .bind(file.job_id, actor, input.expectedFence)
        .first()
      if (!job) throw new SiteConflictError()
      result = {}
    }
  }
  return { ...result, export: input.export, job: file.job_id }
}
