import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { importDomain, importDomains, importMapping, type ImportDomain } from './import-model'
import { scopeImportRun } from './import-access'
import type { ImportRun, ImportRow } from './import-types'

type RunSummary = Pick<
  ImportRun,
  | 'id'
  | 'name'
  | 'domain'
  | 'source_system'
  | 'file_name'
  | 'file_kind'
  | 'stage_state'
  | 'status'
  | 'revision'
  | 'created_at'
  | 'updated_at'
>
type JobStatus = {
  id: string
  status: string
  progress: number
  fence: number
  attempts: number
  error: string | null
}
/** Owner-private source browsing. Resolved CRM snapshots and generated target
 * identifiers are deliberately fetched separately through authorizedImportReview. */
export class ImportRuns {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async scope(site: string, domain: ImportDomain) {
    const identity = await this.authority.require(site, 'identity', 'read')
    if (
      (await this.authority.require(site, importDomains[domain].category, 'read'))
        .authorityRevision !== identity.authorityRevision
    )
      throw new SiteAccessError()
    if (
      domain === 'volunteer-hours' &&
      (await this.authority.require(site, 'restricted-activity', 'read')).authorityRevision !==
        identity.authorityRevision
    )
      throw new SiteAccessError()
    return identity
  }
  private async fence(site: string, epoch: number) {
    if ((await this.authority.require(site, 'identity', 'read')).authorityRevision !== epoch)
      throw new SiteAccessError()
  }
  async context(site: string) {
    const scope = await this.authority.require(site, 'identity', 'read'),
      grants = await this.authority.authoritySet(site)
    if (grants.authorityRevision !== scope.authorityRevision) throw new SiteAccessError()
    const domains = Object.entries(importDomains).flatMap(([domain, definition]) => {
      if (
        !grants.allowed[definition.category]?.includes('read') ||
        (domain === 'volunteer-hours' && !grants.allowed['restricted-activity']?.includes('read'))
      )
        return []
      return [
        {
          id: domain as ImportDomain,
          label: definition.label,
          canCreate: !!grants.allowed[definition.category]?.includes('edit'),
        },
      ]
    })
    await this.fence(site, scope.authorityRevision)
    return { site: { id: scope.id, name: scope.name }, domains }
  }
  async list(input: { site: string; domain: unknown; after?: string }) {
    const domain = importDomain(input.domain),
      scope = await this.scope(input.site, domain)
    if (input.after && (typeof input.after !== 'string' || input.after.length > 128))
      throw new Error('Invalid page cursor.')
    const finance = (await this.authority.authority(input.site, 'finances', 'read')).allowed ? 1 : 0
    const snapshot = await this.db
      .prepare(
        `WITH matching AS (SELECT * FROM vc_crm_import_runs WHERE site_id=? AND domain=? AND actor_id=? AND (financial=0 OR ?=1)),
      page AS(SELECT * FROM matching WHERE id>? ORDER BY id LIMIT 26)
      SELECT (SELECT count(*) FROM matching) AS total,(SELECT json_group_array(json_object('id',id,'name',name,'domain',domain,'source_system',source_system,'file_name',file_name,'file_kind',file_kind,'stage_state',stage_state,'status',status,'revision',revision,'created_at',created_at,'updated_at',updated_at)) FROM page) AS docs`,
      )
      .bind(input.site, domain, this.actor, finance, input.after || '')
      .first<{ total: number; docs: string }>()
    if (!snapshot) throw new Error('The import list could not be loaded.')
    const rows = JSON.parse(snapshot.docs) as RunSummary[]
    const canCreate = (
      await this.authority.authority(input.site, importDomains[domain].category, 'edit')
    ).allowed
    await this.fence(input.site, scope.authorityRevision)
    return {
      docs: rows.slice(0, 25),
      total: snapshot.total,
      next: rows.length > 25 ? rows[24].id : null,
      canCreate,
    }
  }
  async get(site: string, id: string) {
    const { run, site: scope } = await scopeImportRun(this.db, this.actor, site, id)
    const job = run.job_id
      ? await this.db
          .prepare(
            'SELECT id,status,progress,fence,attempts,error FROM vc_crm_jobs WHERE id=? AND actor_id=? AND site_id=? AND kind=?',
          )
          .bind(run.job_id, this.actor, site, 'import-apply')
          .first<JobStatus>()
      : null
    const totals = await this.db
      .prepare(
        `SELECT count(*) AS rows,coalesce(sum(decision IS NOT NULL AND review_hash IS NOT NULL AND review_config_revision=? AND review_authority_revision=?),0) AS reviewed,
      coalesce(sum(applied_at IS NULL),0) AS pending,
      coalesce(sum(applied_at IS NULL AND decision IS NOT NULL AND review_hash IS NOT NULL AND review_config_revision=? AND review_authority_revision=?),0) AS pendingReviewed,
      coalesce(sum(applied_at IS NOT NULL),0) AS applied,coalesce(sum(applied_action='created'),0) AS created,coalesce(sum(applied_action='updated'),0) AS updated,coalesce(sum(applied_action='kept'),0) AS kept,coalesce(sum(applied_action='skipped'),0) AS skipped FROM vc_crm_import_rows WHERE run_id=?`,
      )
      .bind(
        run.config_revision,
        scope.authorityRevision,
        run.config_revision,
        scope.authorityRevision,
        id,
      )
      .first<{
        rows: number
        reviewed: number
        pending: number
        pendingReviewed: number
        applied: number
        created: number
        updated: number
        kept: number
        skipped: number
      }>()
    const mapping = run.mapping_json ? importMapping(JSON.parse(run.mapping_json)) : null
    if (mapping && mapping.domain !== run.domain) throw new SiteAccessError()
    const canEdit = (
      await this.authority.authority(site, importDomains[run.domain].category, 'edit')
    ).allowed
    await this.fence(site, scope.authorityRevision)
    const {
      file_key: _key,
      stage_cursor: _cursor,
      mapping_json: _mapping,
      headers_json: _headers,
      ...metadata
    } = run
    return {
      doc: metadata,
      headers: JSON.parse(run.headers_json) as string[],
      mapping,
      totals,
      job,
      canEdit,
    }
  }
  async rows(input: { site: string; id: string; after?: number; filter?: string }) {
    const { run, site } = await scopeImportRun(this.db, this.actor, input.site, input.id)
    const after = input.after ?? 0,
      filter = input.filter || 'all'
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !['all', 'pending', 'applied', 'unreviewed'].includes(filter)
    )
      throw new Error('Choose a valid import row page and filter.')
    const condition =
      filter === 'pending'
        ? 'AND applied_at IS NULL'
        : filter === 'applied'
          ? 'AND applied_at IS NOT NULL'
          : filter === 'unreviewed'
            ? 'AND applied_at IS NULL AND (review_hash IS NULL OR review_config_revision IS NOT ? OR review_authority_revision IS NOT ?)'
            : ''
    const data = await this.db
      .prepare(
        `WITH matching AS(SELECT * FROM vc_crm_import_rows WHERE run_id=? ${condition}),page AS(SELECT * FROM matching WHERE number>? ORDER BY number LIMIT 26),
      previews AS(SELECT *,
        (SELECT json_group_array(value) FROM(SELECT substr(CAST(value AS TEXT),1,500) AS value FROM json_each(page.data_json) ORDER BY CAST(key AS INTEGER) LIMIT 20)) AS preview_json,
        json_array_length(data_json) AS column_count,
        CASE WHEN json_array_length(data_json)>20 OR EXISTS(SELECT 1 FROM json_each(data_json) WHERE length(CAST(value AS TEXT))>500) THEN 1 ELSE 0 END AS preview_truncated FROM page)
      SELECT (SELECT count(*) FROM matching) AS total,(SELECT json_group_array(json_object('number',number,'preview_json',preview_json,'column_count',column_count,'preview_truncated',preview_truncated,'parse_issues',parse_issues,'revision',revision,'decision',decision,'review_config_revision',review_config_revision,'review_authority_revision',review_authority_revision,'review_hash',review_hash IS NOT NULL,'applied_action',applied_action,'applied_at',applied_at)) FROM previews) AS docs`,
      )
      .bind(
        run.id,
        ...(filter === 'unreviewed' ? [run.config_revision, site.authorityRevision] : []),
        after,
      )
      .first<{ total: number; docs: string }>()
    if (!data) throw new Error('The import rows could not be loaded.')
    const rows = JSON.parse(data.docs) as Array<
      Pick<
        ImportRow,
        | 'number'
        | 'parse_issues'
        | 'revision'
        | 'decision'
        | 'review_config_revision'
        | 'review_authority_revision'
        | 'applied_action'
        | 'applied_at'
      > & {
        review_hash: number
        preview_json: string
        column_count: number
        preview_truncated: number
      }
    >
    await this.fence(input.site, site.authorityRevision)
    return {
      total: data.total,
      next: rows.length > 25 ? rows[24].number : null,
      docs: rows.slice(0, 25).map((row) => ({
        number: row.number,
        previewValues: JSON.parse(row.preview_json) as string[],
        columnCount: row.column_count,
        previewTruncated: !!row.preview_truncated,
        issues: JSON.parse(row.parse_issues),
        revision: row.revision,
        decision: row.decision,
        reviewSaved: !!row.review_hash,
        reviewConfigurationCurrent:
          !!row.review_hash &&
          row.review_config_revision === run.config_revision &&
          row.review_authority_revision === site.authorityRevision,
        appliedAction: row.applied_action,
        appliedAt: row.applied_at,
      })),
    }
  }
  async row(site: string, id: string, number: number) {
    const scoped = await scopeImportRun(this.db, this.actor, site, id)
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Choose a source row.')
    const row = await this.db
      .prepare(
        'SELECT number,data_json,parse_issues,revision,review_hash FROM vc_crm_import_rows WHERE run_id=? AND number=?',
      )
      .bind(id, number)
      .first<
        Pick<ImportRow, 'number' | 'data_json' | 'parse_issues' | 'revision' | 'review_hash'>
      >()
    if (!row) throw new SiteAccessError()
    await this.fence(site, scoped.site.authorityRevision)
    return {
      number: row.number,
      values: JSON.parse(row.data_json) as string[],
      issues: JSON.parse(row.parse_issues),
      revision: row.revision,
      reviewSaved: !!row.review_hash,
    }
  }
}
