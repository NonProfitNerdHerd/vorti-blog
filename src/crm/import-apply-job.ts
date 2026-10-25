import { CRMJobPermanentError, type CRMJobHandler } from './jobs'
import { scopeImportRun } from './import-access'
import { reviewedImportPlan, prepareImportApplication } from './import-application'
import type { ImportRow } from './import-types'

/** Validate every pending row before application. Each domain/claim/audit/row
 * completion then commits under the existing job lease and monotonic fence.
 */
export function importApplyJob(db: D1Database): CRMJobHandler {
  return {
    async prepare(job) {
      const payload = JSON.parse(job.payload) as {
        v?: unknown
        phase?: unknown
        run?: unknown
        revision?: unknown
      }
      if (
        payload.v !== 1 ||
        payload.phase !== 'apply' ||
        typeof payload.run !== 'string' ||
        !Number.isSafeInteger(payload.revision)
      )
        throw new CRMJobPermanentError('invalid-request')
      const { run, site } = await scopeImportRun(db, job.actor_id, job.site_id, payload.run, 'edit')
      if (
        run.status !== 'approved' ||
        run.stage_state !== 'review' ||
        run.revision !== payload.revision ||
        run.job_id !== job.id ||
        run.approved_authority_revision !== site.authorityRevision
      )
        throw new CRMJobPermanentError('stale-review')
      const cursor = job.cursor
        ? (JSON.parse(job.cursor) as { phase?: unknown; after?: unknown })
        : { phase: 'validate', after: 0 }
      if (
        !['validate', 'apply'].includes(String(cursor.phase)) ||
        !Number.isSafeInteger(cursor.after) ||
        Number(cursor.after) < 0
      )
        throw new CRMJobPermanentError('invalid-request')
      const key = crypto.randomUUID(),
        guard = (suffix: string, sql: string, values: unknown[]) => [
          db
            .prepare(`INSERT INTO vc_write_guards(operation_key,affected) ${sql}`)
            .bind(key + '_' + suffix, ...values),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + '_' + suffix),
        ]
      const runGuard = guard(
        'run',
        `SELECT ?,count(*) FROM vc_crm_import_runs WHERE id=? AND actor_id=? AND site_id=? AND status='approved' AND revision=? AND job_id=? AND approved_authority_revision=?`,
        [run.id, job.actor_id, job.site_id, run.revision, job.id, site.authorityRevision],
      )
      const row = await db
        .prepare(
          'SELECT * FROM vc_crm_import_rows WHERE run_id=? AND applied_at IS NULL AND number>? ORDER BY number LIMIT 1',
        )
        .bind(run.id, cursor.after)
        .first<ImportRow>()
      if (!row) {
        if (cursor.phase === 'validate')
          return {
            writes: [
              ...runGuard,
              ...guard(
                'validated',
                `SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM vc_crm_import_rows WHERE run_id=? AND applied_at IS NULL AND validated_revision IS NOT ?) THEN 1 ELSE 0 END`,
                [run.id, run.revision],
              ),
            ],
            cursor: JSON.stringify({ phase: 'apply', after: 0 }),
            processed: 0,
            done: false,
          }
        const totals = await db
          .prepare(
            `SELECT count(*) AS total,coalesce(sum(applied_action='created'),0) AS created,coalesce(sum(applied_action='updated'),0) AS updated,coalesce(sum(applied_action='kept'),0) AS kept,coalesce(sum(applied_action='skipped'),0) AS skipped FROM vc_crm_import_rows WHERE run_id=?`,
          )
          .bind(run.id)
          .first<Record<string, number>>()
        return {
          writes: [
            ...runGuard,
            ...guard(
              'complete',
              `SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM vc_crm_import_rows WHERE run_id=? AND applied_at IS NULL) THEN 1 ELSE 0 END`,
              [run.id],
            ),
          ],
          cursor: JSON.stringify({ phase: 'apply', after: Number(cursor.after) }),
          processed: 0,
          done: true,
          result: { run: run.id, totals },
        }
      }
      if (cursor.phase === 'validate') {
        const plan = await reviewedImportPlan(db, job.actor_id, run, row, key)
        const writes = [
          ...runGuard,
          ...plan.context.guards(key),
          db
            .prepare(
              'UPDATE vc_crm_import_rows SET validated_revision=? WHERE run_id=? AND number=? AND revision=? AND review_hash=? AND applied_at IS NULL',
            )
            .bind(run.revision, run.id, row.number, row.revision, row.review_hash),
          ...guard('row', 'VALUES(?,changes())', []),
        ]
        return {
          writes,
          cursor: JSON.stringify({ phase: 'validate', after: row.number }),
          processed: 0,
          done: false,
        }
      }
      const applied = await prepareImportApplication(db, job.actor_id, run, row, key)
      return {
        writes: applied.writes,
        cursor: JSON.stringify({ phase: 'apply', after: row.number }),
        processed: 1,
        done: false,
      }
    },
  }
}
