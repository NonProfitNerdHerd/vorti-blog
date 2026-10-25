import { SiteConflictError } from '../organizations/atomic'
import { scopeImportRun } from './import-access'
import {
  importMapping,
  importHeadersMatch,
  mapImportRow,
  type MappedImportCell,
} from './import-model'
import { prepareImportDomain, importPlanHash, type ImportDecision } from './import-domain-plan'
import { authorizedImportReview } from './import-review-access'
import { commitCRM, replayCRM } from './mutations'
import type { ImportRow } from './import-types'

/** Staff decisions are saved separately from application. No domain write is
 * executed here, including during validation or a failed review. */
export class ImportReviewRepository {
  constructor(
    private db: D1Database,
    private actor: number,
  ) {}

  async mapping(input: {
    site: string
    id: string
    expectedRevision: number
    operationKey: string
    mapping: unknown
  }) {
    const { run, site } = await scopeImportRun(this.db, this.actor, input.site, input.id, 'edit'),
      mapping = importMapping(input.mapping),
      action = 'import.mapping.configured',
      intent = { id: run.id, expectedRevision: input.expectedRevision, mapping }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'crm-import',
      intent,
    })
    if (replay) return replay
    if (
      run.revision !== input.expectedRevision ||
      run.status !== 'draft' ||
      run.stage_state !== 'review'
    )
      throw new SiteConflictError()
    if (mapping.domain !== run.domain || !importHeadersMatch(mapping, JSON.parse(run.headers_json)))
      throw new Error('Choose a mapping matching this section and its exact source headers.')
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'crm-import',
      id: run.id,
      intent,
      after: { configRevision: run.config_revision + 1 },
      write: this.db
        .prepare(
          "UPDATE vc_crm_import_runs SET mapping_json=?,config_revision=config_revision+1,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='draft' AND stage_state='review'",
        )
        .bind(JSON.stringify(mapping), new Date().toISOString(), run.id, run.revision),
      result: { id: run.id, revision: run.revision + 1, configRevision: run.config_revision + 1 },
    })
  }

  async review(input: {
    site: string
    id: string
    expectedRevision: number
    number: number
    rowRevision: number
    decision: ImportDecision
    target?: string | null
    overrides?: Record<string, MappedImportCell>
    operationKey: string
  }) {
    const { run, site } = await scopeImportRun(this.db, this.actor, input.site, input.id, 'edit'),
      action = 'import.row.reviewed',
      intent = {
        id: run.id,
        expectedRevision: input.expectedRevision,
        number: input.number,
        rowRevision: input.rowRevision,
        decision: input.decision,
        target: input.target ?? null,
        overrides: input.overrides ?? {},
      }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
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
    if (
      !Number.isSafeInteger(input.number) ||
      !['create', 'update', 'keep', 'skip'].includes(input.decision)
    )
      throw new Error('Choose a source row and an explicit review decision.')
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_import_rows WHERE run_id=? AND number=?')
      .bind(run.id, input.number)
      .first<ImportRow>()
    if (!row || row.revision !== input.rowRevision || row.applied_at) throw new SiteConflictError()
    const mapping = importMapping(JSON.parse(run.mapping_json)),
      mapped = mapImportRow(
        {
          number: row.number,
          values: JSON.parse(row.data_json),
          issues: JSON.parse(row.parse_issues),
        },
        mapping,
      ),
      values = { ...mapped.values, ...input.overrides },
      request = {
        site: run.site_id,
        domain: run.domain,
        sourceSystem: run.source_system,
        values,
        decision: input.decision,
        target: input.target ?? null,
        operationKey: input.operationKey + '_preview',
      }
    let plan
    try {
      plan = await prepareImportDomain(this.db, this.actor, request)
    } catch (error) {
      // Authorization, stale-record and infrastructure errors must never be
      // converted into a cached disclosure or a successful review.
      if (!(error instanceof Error) || !/^(Choose|Enter)/.test(error.message)) throw error
      plan = await prepareImportDomain(this.db, this.actor, {
        ...request,
        decision: 'skip',
        target: null,
      })
      plan.review.selection = { decision: input.decision, target: input.target ?? null }
      plan.review.issues.push({ message: error.message })
    }
    if (input.decision !== 'skip') plan.review.issues.push(...mapped.issues)
    const serialized = JSON.stringify(plan.review)
    if (new TextEncoder().encode(serialized).length > 1048576)
      throw new Error('Choose fewer or shorter review values for this row.')
    const hash = await importPlanHash(plan.review),
      now = new Date().toISOString(),
      guard = input.operationKey + '_run'
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: run.site_id,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'crm-import',
      id: run.id,
      intent,
      after: { number: row.number, decision: input.decision, issues: plan.review.issues.length },
      write: this.db
        .prepare(
          "UPDATE vc_crm_import_runs SET financial=max(financial,?),updated_at=? WHERE id=? AND revision=? AND status='draft' AND stage_state='review' AND config_revision=?",
        )
        .bind(plan.financial ? 1 : 0, now, run.id, run.revision, run.config_revision),
      dependent: [
        this.db
          .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
          .bind(guard),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
        ...plan.context.guards(input.operationKey + '_snapshot'),
        this.db
          .prepare(
            'UPDATE vc_crm_import_rows SET revision=revision+1,decision=?,target_id=?,source_id=?,review_json=?,review_hash=?,review_config_revision=?,review_authority_revision=?,validated_revision=NULL WHERE run_id=? AND number=? AND revision=? AND applied_at IS NULL',
          )
          .bind(
            input.decision,
            plan.review.targetID,
            plan.review.sourceID,
            serialized,
            hash,
            run.config_revision,
            site.authorityRevision,
            run.id,
            row.number,
            row.revision,
          ),
        this.db
          .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
          .bind(guard + '_row'),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard + '_row'),
      ],
      result: {
        id: run.id,
        number: row.number,
        revision: row.revision + 1,
        issues: plan.review.issues,
      },
    })
  }

  async snapshot(site: string, id: string, number: number) {
    await scopeImportRun(this.db, this.actor, site, id)
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_import_rows WHERE run_id=? AND number=?')
      .bind(id, number)
      .first<ImportRow>()
    if (!row) throw new SiteConflictError()
    return authorizedImportReview(this.db, this.actor, site, id, row)
  }
}
