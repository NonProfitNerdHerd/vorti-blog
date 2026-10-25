import { SiteConflictError } from '../organizations/atomic'
import { scopeImportRun } from './import-access'
import { commitCRM, replayCRM } from './mutations'
export async function startImportStaging(
  db: D1Database,
  actor: number,
  input: { site: string; id: string; expectedRevision: number; operationKey: string },
) {
  const { run, site } = await scopeImportRun(db, actor, input.site, input.id, 'edit'),
    action = 'import.staging.started',
    intent = { id: run.id, expectedRevision: input.expectedRevision }
  const replay = await replayCRM(db, actor, input.operationKey, {
    site: input.site,
    action,
    type: 'crm-import',
    intent,
  })
  if (replay) return replay
  if (
    run.revision !== input.expectedRevision ||
    run.status !== 'draft' ||
    run.stage_state !== 'ready' ||
    !run.file_uploaded_at ||
    run.job_id ||
    !run.stage_cursor ||
    !JSON.parse(run.headers_json).length
  )
    throw new SiteConflictError()
  const job = crypto.randomUUID(),
    now = new Date().toISOString(),
    revision = run.revision + 1
  return commitCRM({
    db,
    actor,
    key: input.operationKey,
    site: run.site_id,
    organization: site.organization_id,
    authorityRevision: site.authorityRevision,
    action,
    type: 'crm-import',
    id: run.id,
    intent,
    after: { job, stage: 'staging' },
    write: db
      .prepare(
        "INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'import-apply',?,?,?,?)",
      )
      .bind(
        job,
        run.site_id,
        actor,
        JSON.stringify({ v: 1, phase: 'stage', run: run.id, revision }),
        now,
        now,
        now,
      ),
    dependent: [
      db
        .prepare(
          "UPDATE vc_crm_import_runs SET stage_state='staging',job_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='draft' AND stage_state='ready' AND job_id IS NULL",
        )
        .bind(job, now, run.id, run.revision),
      db
        .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
        .bind(input.operationKey + '_run'),
      db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(input.operationKey + '_run'),
    ],
    result: { id: run.id, revision, job },
  })
}
