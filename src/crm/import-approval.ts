import { SiteConflictError } from '../organizations/atomic'
import { scopeImportRun } from './import-access'
import { commitCRM, replayCRM } from './mutations'

type Input = { site: string; id: string; expectedRevision: number; operationKey: string }
export async function approveImport(
  db: D1Database,
  actor: number,
  input: Input & { allowNewUnidentified: boolean },
) {
  const { run, site } = await scopeImportRun(db, actor, input.site, input.id, 'edit'),
    action = 'import.approved',
    intent = {
      id: input.id,
      expectedRevision: input.expectedRevision,
      allowNewUnidentified: input.allowNewUnidentified,
    }
  const replay = await replayCRM(db, actor, input.operationKey, {
    site: input.site,
    action,
    type: 'crm-import',
    intent,
  })
  if (replay) return replay
  if (typeof input.allowNewUnidentified !== 'boolean')
    throw new Error('Choose whether to allow new records without source identifiers.')
  if (
    run.revision !== input.expectedRevision ||
    run.status !== 'draft' ||
    run.stage_state !== 'review' ||
    !run.mapping_json
  )
    throw new SiteConflictError()
  const terminal = await db
    .prepare("SELECT count(*) AS n FROM vc_crm_jobs WHERE id=? AND status IN('pending','running')")
    .bind(run.job_id)
    .first<{ n: number }>()
  if (terminal?.n) throw new SiteConflictError()
  const summary = await db
    .prepare(
      `SELECT count(*) AS pending,
    coalesce(sum(decision IS NULL OR review_hash IS NULL OR review_config_revision IS NOT ? OR review_authority_revision IS NOT ? OR json_type(review_json,'$.issues') IS NOT 'array' OR (decision<>'skip' AND json_array_length(json_extract(review_json,'$.issues'))<>0)),0) AS invalid,
    coalesce(sum(decision='create' AND source_id IS NULL),0) AS unidentified
    FROM vc_crm_import_rows WHERE run_id=? AND applied_at IS NULL`,
    )
    .bind(run.config_revision, site.authorityRevision, run.id)
    .first<{ pending: number; invalid: number; unidentified: number }>()
  if (!summary?.pending || summary.invalid)
    throw new Error(
      'Choose a valid, current review decision for every pending row before approval.',
    )
  if (summary.unidentified && !input.allowNewUnidentified)
    throw new Error(
      'Choose explicit approval for new records without source identifiers or map their source identifiers.',
    )
  const duplicates = await db
    .prepare(
      `SELECT count(*) AS n FROM (
    SELECT source_id FROM vc_crm_import_rows WHERE run_id=? AND decision<>'skip' AND source_id IS NOT NULL GROUP BY source_id HAVING count(*)>1
    UNION ALL SELECT target_id FROM vc_crm_import_rows WHERE run_id=? AND decision<>'skip' AND target_id IS NOT NULL GROUP BY target_id HAVING count(*)>1
  )`,
    )
    .bind(run.id, run.id)
    .first<{ n: number }>()
  if (duplicates?.n)
    throw new Error('Choose distinct source and target records for each row or skip duplicates.')
  const job = crypto.randomUUID(),
    now = new Date().toISOString(),
    revision = run.revision + 1,
    guard = input.operationKey + '_run'
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
    after: {
      job,
      revision,
      pending: summary.pending,
      allowNewUnidentified: input.allowNewUnidentified,
    },
    write: db
      .prepare(
        "INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'import-apply',?,?,?,?)",
      )
      .bind(
        job,
        run.site_id,
        actor,
        JSON.stringify({ v: 1, phase: 'apply', run: run.id, revision }),
        now,
        now,
        now,
      ),
    dependent: [
      db
        .prepare(
          "UPDATE vc_crm_import_runs SET status='approved',revision=revision+1,job_id=?,allow_new_unidentified=?,approved_authority_revision=?,updated_at=? WHERE id=? AND revision=? AND status='draft' AND stage_state='review' AND NOT EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=vc_crm_import_runs.job_id AND j.status IN('pending','running'))",
        )
        .bind(
          job,
          input.allowNewUnidentified ? 1 : 0,
          site.authorityRevision,
          now,
          run.id,
          run.revision,
        ),
      db
        .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
        .bind(guard),
      db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
    ],
    result: { id: run.id, revision, job },
  })
}

/** Applied rows remain immutable. A fresh approval reruns validation for every
 * remaining row, while terminal jobs retain their original payload/history. */
export async function reopenImport(db: D1Database, actor: number, input: Input) {
  const { run, site } = await scopeImportRun(db, actor, input.site, input.id, 'edit'),
    action = 'import.reopened',
    intent = { id: input.id, expectedRevision: input.expectedRevision }
  const replay = await replayCRM(db, actor, input.operationKey, {
    site: input.site,
    action,
    type: 'crm-import',
    intent,
  })
  if (replay) return replay
  if (
    run.revision !== input.expectedRevision ||
    run.status !== 'approved' ||
    run.stage_state !== 'review'
  )
    throw new SiteConflictError()
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
    after: { status: 'draft' },
    write: db
      .prepare(
        "UPDATE vc_crm_import_runs SET status='draft',revision=revision+1,job_id=NULL,approved_authority_revision=NULL,updated_at=? WHERE id=? AND revision=? AND status='approved' AND NOT EXISTS(SELECT 1 FROM vc_crm_jobs j WHERE j.id=vc_crm_import_runs.job_id AND j.status IN('pending','running')) AND EXISTS(SELECT 1 FROM vc_crm_import_rows r WHERE r.run_id=vc_crm_import_runs.id AND r.applied_at IS NULL)",
      )
      .bind(new Date().toISOString(), run.id, run.revision),
    result: { id: run.id, revision: run.revision + 1 },
  })
}
