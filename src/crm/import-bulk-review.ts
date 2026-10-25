import { SiteConflictError } from '../organizations/atomic'
import { scopeImportRun } from './import-access'
import { commitCRM, replayCRM } from './mutations'
export type ImportBulkPolicy = 'create-or-keep' | 'create-or-update' | 'skip'
export async function startImportBulkReview(
  db: D1Database,
  actor: number,
  input: {
    site: string
    id: string
    expectedRevision: number
    operationKey: string
    policy: unknown
  },
) {
  if (!['create-or-keep', 'create-or-update', 'skip'].includes(String(input.policy)))
    throw Error('Choose a supported bulk review policy.')
  const { run, site } = await scopeImportRun(db, actor, input.site, input.id, 'edit'),
    action = 'import.bulk-review.started',
    intent = { id: input.id, expectedRevision: input.expectedRevision, policy: input.policy }
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
    run.stage_state !== 'review' ||
    !run.mapping_json
  )
    throw new SiteConflictError()
  const job = crypto.randomUUID(),
    now = new Date().toISOString(),
    revision = run.revision + 1
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
    after: { job, policy: input.policy },
    write: db
      .prepare(
        `INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,'import-apply',?,?,?,?)`,
      )
      .bind(
        job,
        input.site,
        actor,
        JSON.stringify({
          v: 1,
          phase: 'review',
          run: run.id,
          revision,
          authorityRevision: site.authorityRevision,
          policy: input.policy,
        }),
        now,
        now,
        now,
      ),
    dependent: [
      db
        .prepare(
          `UPDATE vc_crm_import_runs SET job_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='draft' AND stage_state='review'
        AND NOT EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=vc_crm_import_runs.job_id AND j.status IN('pending','running'))`,
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
