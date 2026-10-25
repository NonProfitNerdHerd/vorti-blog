import { CRMJobPermanentError, type CRMJobHandler } from './jobs'
import { scopeImportRun } from './import-access'
import { importMapping, mapImportRow } from './import-model'
import { ImportContext } from './import-context'
import { ImportReviewRepository } from './import-review'
import { PreparedCRMMutations } from './prepared-mutations'
import type { ImportRow } from './import-types'
import type { ImportDecision } from './import-domain-plan'

/** Proposal bookkeeping only. Domain preparation performs no donor writes. */
export function importReviewJob(db: D1Database): CRMJobHandler {
  return {
    async prepare(job) {
      const payload = JSON.parse(job.payload) as {
        v?: unknown
        phase?: unknown
        run?: unknown
        revision?: unknown
        authorityRevision?: unknown
        policy?: unknown
      }
      if (
        payload.v !== 1 ||
        payload.phase !== 'review' ||
        typeof payload.run !== 'string' ||
        !Number.isSafeInteger(payload.revision) ||
        !Number.isSafeInteger(payload.authorityRevision) ||
        !['create-or-keep', 'create-or-update', 'skip'].includes(String(payload.policy))
      )
        throw new CRMJobPermanentError('invalid-request')
      const { run, site } = await scopeImportRun(db, job.actor_id, job.site_id, payload.run, 'edit')
      if (
        run.status !== 'draft' ||
        run.stage_state !== 'review' ||
        run.revision !== payload.revision ||
        run.job_id !== job.id ||
        site.authorityRevision !== payload.authorityRevision ||
        !run.mapping_json
      )
        throw new CRMJobPermanentError('stale-review')
      const after = job.cursor ? Number(job.cursor) : 0
      if (!Number.isSafeInteger(after) || after < 0)
        throw new CRMJobPermanentError('invalid-request')
      const row = await db
        .prepare(
          'SELECT * FROM vc_crm_import_rows WHERE run_id=? AND number>? AND applied_at IS NULL AND decision IS NULL ORDER BY number LIMIT 1',
        )
        .bind(run.id, after)
        .first<ImportRow>()
      const key = crypto.randomUUID(),
        writes = [
          db
            .prepare(
              `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_import_runs WHERE id=? AND job_id=? AND revision=? AND status='draft' AND stage_state='review'`,
            )
            .bind(key + '_run', run.id, job.id, run.revision),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + '_run'),
          db
            .prepare(
              `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?`,
            )
            .bind(key + '_authority', site.organization_id, site.authorityRevision),
          db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key + '_authority'),
        ]
      if (!row)
        return {
          writes,
          cursor: String(after),
          processed: 0,
          done: true,
          result: { run: run.id, phase: 'review' },
        }
      let decision: ImportDecision = payload.policy === 'skip' ? 'skip' : 'create'
      if (decision !== 'skip') {
        const mapped = mapImportRow(
          {
            number: row.number,
            values: JSON.parse(row.data_json),
            issues: JSON.parse(row.parse_issues),
          },
          importMapping(JSON.parse(run.mapping_json)),
        )
        const context = await ImportContext.open(
          db,
          job.actor_id,
          job.site_id,
          run.domain,
          run.source_system,
        )
        const sourceID = mapped.values.sourceID?.value.trim(),
          explicit = mapped.values.recordID?.value.trim(),
          source = sourceID ? await context.source(run.domain, sourceID) : null
        if (explicit || source) decision = payload.policy === 'create-or-update' ? 'update' : 'keep'
      }
      const preparation = new PreparedCRMMutations(db, job.actor_id)
      await new ImportReviewRepository(db, job.actor_id, preparation.commit).review({
        site: job.site_id,
        id: run.id,
        expectedRevision: run.revision,
        number: row.number,
        rowRevision: row.revision,
        decision,
        operationKey: key,
      })
      if (preparation.count !== 1) throw new CRMJobPermanentError('invalid-request')
      writes.push(...(await preparation.statements()))
      return { writes, cursor: String(row.number), processed: 1, done: false }
    },
  }
}
