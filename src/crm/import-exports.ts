import { SiteConflictError } from '../organizations/atomic'
import { SiteAccessError } from '../organizations/repository'
import { scopeImportRun } from './import-access'
import { commitCRM, replayCRM } from './mutations'
import { importResultCondition } from './import-result-format'
export type ImportExport = {
  id: string
  run_id: string
  job_id: string
  run_revision: number
  run_updated_at: string
  authority_revision: number
  errors_only: number
  expected_rows: number
  columns: number
  created_at: string
  expires_at: string
}
export async function scopeImportExport(
  db: D1Database,
  actor: number,
  siteID: string,
  id: string,
  now = Date.now(),
) {
  const file = await db
    .prepare('SELECT * FROM vc_crm_import_exports WHERE id=?')
    .bind(id)
    .first<ImportExport>()
  if (!file) throw new SiteAccessError()
  const scoped = await scopeImportRun(db, actor, siteID, file.run_id)
  if (file.expires_at <= new Date(now).toISOString())
    throw Error('This result file expired. Prepare a new download.')
  if (
    scoped.site.authorityRevision !== file.authority_revision ||
    scoped.run.revision !== file.run_revision ||
    scoped.run.updated_at !== file.run_updated_at
  )
    throw new SiteConflictError()
  const active = await db
    .prepare("SELECT count(*) AS n FROM vc_crm_jobs WHERE id=? AND status IN('pending','running')")
    .bind(scoped.run.job_id)
    .first<{ n: number }>()
  if (active?.n) throw new SiteConflictError()
  return { ...scoped, file }
}
export async function startImportExport(
  db: D1Database,
  actor: number,
  input: {
    site: string
    id: string
    expectedRevision: number
    errorsOnly: boolean
    operationKey: string
  },
  now = Date.now(),
) {
  const { run, site } = await scopeImportRun(db, actor, input.site, input.id),
    action = 'import.results.requested',
    intent = {
      id: input.id,
      expectedRevision: input.expectedRevision,
      errorsOnly: input.errorsOnly,
    }
  const replay = await replayCRM(db, actor, input.operationKey, {
    site: input.site,
    action,
    type: 'crm-import',
    intent,
  })
  if (replay) return replay
  if (
    run.revision !== input.expectedRevision ||
    run.stage_state !== 'review' ||
    typeof input.errorsOnly !== 'boolean'
  )
    throw new SiteConflictError()
  const active = await db
    .prepare("SELECT count(*) AS n FROM vc_crm_jobs WHERE id=? AND status IN('pending','running')")
    .bind(run.job_id)
    .first<{ n: number }>()
  if (active?.n) throw Error('Wait for import processing to stop before preparing results.')
  const size = await db
    .prepare(
      'SELECT count(*) AS n,coalesce(max(json_array_length(data_json)),0) AS width FROM vc_crm_import_rows WHERE run_id=?' +
        importResultCondition(input.errorsOnly),
    )
    .bind(run.id)
    .first<{ n: number; width: number }>()
  if (!size) throw Error('Unable to count import result rows.')
  const id = crypto.randomUUID(),
    job = crypto.randomUUID(),
    timestamp = new Date(now).toISOString(),
    expires = new Date(now + 7 * 86400000).toISOString(),
    width = Math.max(size.width, (JSON.parse(run.headers_json) as string[]).length)
  return commitCRM({
    db,
    actor,
    key: input.operationKey,
    site: input.site,
    organization: site.organization_id,
    authorityRevision: site.authorityRevision,
    action,
    type: 'crm-import',
    id: run.id,
    intent,
    after: { export: id, job, errorsOnly: input.errorsOnly, expires },
    write: db
      .prepare(
        "INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'import-apply',?,?,?,?)",
      )
      .bind(
        job,
        input.site,
        actor,
        JSON.stringify({ v: 1, phase: 'results', export: id }),
        timestamp,
        timestamp,
        timestamp,
      ),
    dependent: [
      db
        .prepare(
          'INSERT INTO vc_crm_import_exports(id,run_id,job_id,run_revision,run_updated_at,authority_revision,errors_only,expected_rows,columns,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          run.id,
          job,
          run.revision,
          run.updated_at,
          site.authorityRevision,
          input.errorsOnly ? 1 : 0,
          size.n,
          width,
          timestamp,
          expires,
        ),
      db
        .prepare(
          "INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_import_runs WHERE id=? AND revision=? AND updated_at=? AND NOT EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=vc_crm_import_runs.job_id AND j.status IN('pending','running'))",
        )
        .bind(input.operationKey + '_run', run.id, run.revision, run.updated_at),
      db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(input.operationKey + '_run'),
    ],
    result: { id: run.id, export: id, job },
  })
}
