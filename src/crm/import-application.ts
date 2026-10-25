import { SiteConflictError } from '../organizations/atomic'
import { CRMJobPermanentError } from './jobs'
import { prepareImportDomain, importPlanHash, type ImportReview } from './import-domain-plan'
import { prepareCRMCheckpoint } from './mutations'
import type { ImportRun, ImportRow } from './import-types'

/** Recompute the approved snapshot before every application/validation step. */
export async function reviewedImportPlan(
  db: D1Database,
  actor: number,
  run: ImportRun,
  row: ImportRow,
  key: string,
) {
  if (
    run.actor_id !== actor ||
    run.status !== 'approved' ||
    run.stage_state !== 'review' ||
    row.run_id !== run.id ||
    row.applied_at ||
    !row.review_json ||
    !row.review_hash ||
    row.review_config_revision !== run.config_revision ||
    row.review_authority_revision !== run.approved_authority_revision
  )
    throw new CRMJobPermanentError('stale-review')
  let review: ImportReview
  try {
    review = JSON.parse(row.review_json) as ImportReview
  } catch {
    throw new CRMJobPermanentError('invalid-request')
  }
  if (
    review.version !== 1 ||
    review.site !== run.site_id ||
    review.domain !== run.domain ||
    review.actor !== actor ||
    review.sourceSystem !== run.source_system ||
    review.sourceID !== row.source_id ||
    review.targetID !== row.target_id ||
    review.selection?.decision !== row.decision ||
    !Array.isArray(review.issues) ||
    review.issues.length
  )
    throw new CRMJobPermanentError('stale-review')
  if ((await importPlanHash(review)) !== row.review_hash)
    throw new CRMJobPermanentError('stale-review')
  try {
    const plan = await prepareImportDomain(db, actor, {
      site: run.site_id,
      domain: run.domain,
      sourceSystem: run.source_system,
      values: review.values,
      decision: review.selection.decision,
      target: review.selection.target,
      operationKey: key,
    })
    if (
      plan.hash !== row.review_hash ||
      plan.context.site.authorityRevision !== run.approved_authority_revision ||
      (plan.financial && run.financial !== 1)
    )
      throw new CRMJobPermanentError('stale-review')
    return plan
  } catch (error) {
    if (
      error instanceof SiteConflictError ||
      (error instanceof Error && /^(Choose|Enter|This record)/.test(error.message))
    )
      throw new CRMJobPermanentError('stale-review')
    throw error
  }
}

/** Domain write + receipt/audit + immutable source claim + row completion. Execute
 * only inside CRMJobs' fenced atomic checkpoint. This function commits nothing.
 */
export async function prepareImportApplication(
  db: D1Database,
  actor: number,
  run: ImportRun,
  row: ImportRow,
  key: string,
) {
  if (row.validated_revision !== run.revision) throw new CRMJobPermanentError('stale-review')
  const plan = await reviewedImportPlan(db, actor, run, row, key),
    ctx = plan.context,
    now = new Date().toISOString()
  const checked = (suffix: string, sql: string, values: unknown[]) => [
    db
      .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
      .bind(key + '_' + suffix, ...values),
    db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + '_' + suffix),
  ]
  const writes = [
    ...checked(
      'run',
      `SELECT ?,count(*) FROM vc_crm_import_runs WHERE id=? AND site_id=? AND actor_id=? AND status='approved' AND revision=? AND config_revision=? AND job_id=? AND approved_authority_revision=?`,
      [
        run.id,
        run.site_id,
        actor,
        run.revision,
        run.config_revision,
        run.job_id,
        run.approved_authority_revision,
      ],
    ),
    ...checked(
      'row',
      `SELECT ?,count(*) FROM vc_crm_import_rows WHERE run_id=? AND number=? AND revision=? AND review_hash=? AND validated_revision=? AND applied_at IS NULL`,
      [run.id, row.number, row.revision, row.review_hash, run.revision],
    ),
    ...plan.writes,
  ]
  if (plan.review.sourceID && plan.recordID && row.decision !== 'skip') {
    const fingerprint = await importPlanHash({ domain: run.domain, values: plan.review.values })
    if (plan.review.source) {
      writes.push(
        db
          .prepare(
            `UPDATE vc_crm_source_identifiers SET fingerprint=?,revision=revision+1,created_run_id=coalesce(created_run_id,?),last_run_id=?,updated_at=? WHERE organization_id=? AND site_id=? AND domain=? AND platform=? AND external_id=? AND revision=? AND record_id=?`,
          )
          .bind(
            fingerprint,
            run.id,
            run.id,
            now,
            ctx.site.organization_id,
            run.site_id,
            run.domain,
            run.source_system,
            plan.review.sourceID,
            plan.review.source.revision,
            plan.recordID,
          ),
      )
    } else {
      writes.push(
        db
          .prepare(
            `INSERT INTO vc_crm_source_identifiers(organization_id,site_id,domain,platform,external_id,record_id,fingerprint,revision,created_run_id,last_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)`,
          )
          .bind(
            ctx.site.organization_id,
            run.site_id,
            run.domain,
            run.source_system,
            plan.review.sourceID,
            plan.recordID,
            fingerprint,
            run.id,
            run.id,
            now,
            now,
          ),
      )
    }
    writes.push(...checked('source', 'VALUES(?,changes())', []))
  }
  const action =
    row.decision === 'create'
      ? 'created'
      : row.decision === 'update'
        ? 'updated'
        : row.decision === 'keep'
          ? 'kept'
          : 'skipped'
  const result = { run: run.id, number: row.number, action, record: plan.recordID }
  writes.push(
    ...(await prepareCRMCheckpoint({
      db,
      actor,
      key: key + '_row',
      site: run.site_id,
      organization: ctx.site.organization_id,
      authorityRevision: ctx.site.authorityRevision,
      action: 'import.row.applied',
      type: 'crm-import',
      id: run.id,
      before: { number: row.number, reviewHash: row.review_hash },
      after: {
        ...result,
        domain: run.domain,
        sourceSystem: run.source_system,
        sourceID: plan.review.sourceID,
      },
      intent: {
        run: run.id,
        number: row.number,
        revision: row.revision,
        reviewHash: row.review_hash,
      },
      write: db
        .prepare(
          `UPDATE vc_crm_import_rows SET applied_id=?,applied_action=?,applied_at=? WHERE run_id=? AND number=? AND revision=? AND review_hash=? AND validated_revision=? AND applied_at IS NULL`,
        )
        .bind(
          plan.recordID,
          action,
          now,
          run.id,
          row.number,
          row.revision,
          row.review_hash,
          run.revision,
        ),
      result,
    })),
  )
  return { writes, result }
}
