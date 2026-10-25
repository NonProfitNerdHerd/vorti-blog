import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import type { InformationCategory } from '../organizations/policy'
import { importDomains, type ImportDomain, type ImportField } from './import-model'

export type ImportReference = NonNullable<ImportField['reference']>
type Reference = ImportReference
export type ImportVisibility = {
  references: Array<{ kind: ImportReference; id: string }>
  contacts: string[]
}
type RecordRow = Record<string, unknown> & {
  id: string
  label: string
  revision: number
  affiliation_revision?: number
}
export const importReferenceRules: Record<
  Reference,
  { category: InformationCategory; sql: string }
> = {
  contacts: {
    category: 'identity',
    sql: `SELECT c.id,c.label,c.revision,c.kind,a.revision AS affiliation_revision FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id WHERE a.site_id=? AND c.id=? AND a.archived=0 AND c.archived=0`,
  },
  households: {
    category: 'affiliations',
    sql: `SELECT id,name AS label,revision,archived FROM vc_crm_households WHERE site_id=? AND id=?`,
  },
  'relationship-types': {
    category: 'affiliations',
    sql: `SELECT id,label,reciprocal_label,revision,archived FROM vc_crm_relationship_types WHERE site_id=? AND id=?`,
  },
  funds: {
    category: 'finances',
    sql: `SELECT id,name AS label,revision,archived FROM vc_crm_funds WHERE site_id=? AND id=?`,
  },
  campaigns: {
    category: 'finances',
    sql: `SELECT id,name AS label,revision,archived FROM vc_crm_campaigns WHERE site_id=? AND id=?`,
  },
  appeals: {
    category: 'finances',
    sql: `SELECT id,name AS label,campaign_id,revision,archived FROM vc_crm_appeals WHERE site_id=? AND id=?`,
  },
  'membership-types': {
    category: 'memberships',
    sql: `SELECT *,name AS label FROM vc_crm_membership_types WHERE site_id=? AND id=?`,
  },
  memberships: {
    category: 'memberships',
    sql: `SELECT id,type_name AS label,revision,person_id,household_id,starts_on,ends_on,cancelled_on FROM vc_crm_membership_terms WHERE site_id=? AND id=?`,
  },
  'volunteer-activities': {
    category: 'restricted-activity',
    sql: `SELECT *,name AS label FROM vc_crm_volunteer_activities WHERE site_id=? AND id=?`,
  },
}
export type ImportSourceIdentifier = {
  organization_id: string
  site_id: string
  domain: string
  platform: string
  external_id: string
  record_id: string
  revision: number
  fingerprint: string | null
  created_run_id: string | null
}
type ReadCheck = {
  sql: string
  values: (string | number | null)[]
  snapshot: Record<string, unknown>
  same: string[]
}
/** One request/step only. No global authorization or private-record cache. */
export class ImportContext {
  private authority: OrganizationRepository
  private checked = new Set<string>()
  private checks: ReadCheck[] = []
  private referenceRows = new Map<string, RecordRow>()
  private coveredContacts = new Set<string>()
  private constructor(
    readonly db: D1Database,
    readonly actor: number,
    readonly siteID: string,
    readonly domain: ImportDomain,
    readonly sourceSystem: string,
    readonly site: Awaited<ReturnType<OrganizationRepository['require']>>,
  ) {
    this.authority = new OrganizationRepository(db, actor)
    this.checked.add('identity:read')
    this.checked.add(`${importDomains[domain].category}:read`)
    this.checked.add(`${importDomains[domain].category}:edit`)
  }
  static async open(
    db: D1Database,
    actor: number,
    siteID: string,
    domain: ImportDomain,
    sourceSystem: string,
  ) {
    const authority = new OrganizationRepository(db, actor),
      category = importDomains[domain].category
    const site = await authority.require(siteID, category, 'edit')
    for (const name of new Set<InformationCategory>(['identity', category])) {
      if (
        (await authority.require(siteID, name, 'read')).authorityRevision !== site.authorityRevision
      )
        throw new SiteAccessError()
    }
    return new ImportContext(db, actor, siteID, domain, sourceSystem, site)
  }
  async require(category: InformationCategory, operation: 'read' | 'edit') {
    const key = `${category}:${operation}`
    if (!this.checked.has(key)) {
      if (
        (await this.authority.require(this.siteID, category, operation)).authorityRevision !==
        this.site.authorityRevision
      )
        throw new SiteAccessError()
      this.checked.add(key)
    }
  }
  async source(domain: ImportDomain, external: string): Promise<ImportSourceIdentifier | null> {
    const sql =
      'SELECT organization_id,site_id,domain,platform,external_id,record_id,revision,fingerprint,created_run_id FROM vc_crm_source_identifiers WHERE organization_id=? AND site_id=? AND domain=? AND platform=? AND external_id=?'
    const values = [this.site.organization_id, this.siteID, domain, this.sourceSystem, external]
    const row = await this.db
      .prepare(sql)
      .bind(...values)
      .first<ImportSourceIdentifier>()
    if (row)
      this.checks.push({
        sql,
        values,
        snapshot: row,
        same: ['record_id', 'revision', 'fingerprint'],
      })
    else this.checks.push({ sql, values, snapshot: {}, same: [] })
    return row
  }
  async reference(
    kind: Reference,
    value: string,
    mode: 'record' | 'source' = 'record',
    allowArchived = false,
  ): Promise<RecordRow> {
    const rule = importReferenceRules[kind]
    await this.require(rule.category, 'read')
    let id = value.trim()
    if (mode === 'source') {
      if (!Object.hasOwn(importDomains, kind))
        throw new Error('Choose a CRM record identifier for this linked field.')
      const source = await this.source(kind as ImportDomain, id)
      if (!source)
        throw new Error('Choose an imported source identifier already available in this chapter.')
      id = source.record_id
    }
    if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id))
      throw new Error('Choose a valid linked CRM record.')
    const key = `${kind}:${id}`,
      cached = this.referenceRows.get(key)
    const row = cached ?? (await this.db.prepare(rule.sql).bind(this.siteID, id).first<RecordRow>())
    if (!row) throw new Error('Choose a linked record available in this chapter.')
    if (!allowArchived && row.archived === 1) throw new Error('Choose an active linked record.')
    if (!cached) {
      this.referenceRows.set(key, row)
      this.checks.push({
        sql: rule.sql,
        values: [this.siteID, id],
        snapshot: row,
        same: [
          'revision',
          ...(row.affiliation_revision === undefined ? [] : ['affiliation_revision']),
        ],
      })
    }
    return row
  }
  /** Add a complete authorized target or uniqueness/range snapshot. SQL is server-authored. */
  remember(
    sql: string,
    values: (string | number | null)[],
    snapshot: Record<string, unknown>,
    same: string[],
  ) {
    this.checks.push({ sql, values, snapshot, same })
  }
  snapshots() {
    return this.checks.map((check) => ({
      sql: check.sql,
      values: check.values,
      state: Object.fromEntries(check.same.map((name) => [name, check.snapshot[name] ?? null])),
    }))
  }
  async coverContacts(ids: string[]) {
    const unique = [...new Set(ids)].sort(),
      json = JSON.stringify(unique)
    const sql = `SELECT count(DISTINCT c.id) AS n FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id WHERE a.site_id=? AND a.archived=0 AND c.archived=0 AND c.id IN(SELECT value FROM json_each(?))`
    const snapshot = (await this.db.prepare(sql).bind(this.siteID, json).first<{ n: number }>())!
    if (snapshot.n !== unique.length) throw new SiteAccessError()
    this.remember(sql, [this.siteID, json], snapshot, ['n'])
    for (const id of unique) this.coveredContacts.add(id)
  }
  visibility(): ImportVisibility {
    const records = [...this.referenceRows.keys()].map((key) => {
      const split = key.indexOf(':')
      return { kind: key.slice(0, split) as ImportReference, id: key.slice(split + 1) }
    })
    return {
      references: records,
      contacts: [
        ...new Set([
          ...this.coveredContacts,
          ...records.filter((record) => record.kind === 'contacts').map((record) => record.id),
        ]),
      ].sort(),
    }
  }
  async finish() {
    if (
      (await this.authority.require(this.siteID, importDomains[this.domain].category, 'edit'))
        .authorityRevision !== this.site.authorityRevision
    )
      throw new SiteAccessError()
    for (const check of this.checks) {
      const current = await this.db
        .prepare(check.sql)
        .bind(...check.values)
        .first<Record<string, unknown>>()
      if (!check.same.length) {
        if (current) throw new SiteConflictError()
        continue
      }
      if (
        !current ||
        check.same.some((name) => (current[name] ?? null) !== (check.snapshot[name] ?? null))
      )
        throw new SiteConflictError()
    }
    const current = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(this.site.organization_id)
      .first<{ authority_revision: number }>()
    if (current?.authority_revision !== this.site.authorityRevision) throw new SiteAccessError()
  }
  guards(operationKey: string) {
    const writes: D1PreparedStatement[] = []
    // Group predicates below both D1's parameter budget and the job statement budget.
    let predicates: string[] = [],
      values: unknown[] = [],
      group = 0
    const flush = () => {
      if (!predicates.length) return
      const key = `${operationKey}_ref${group++}`
      writes.push(
        this.db
          .prepare(
            `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN ${predicates.join(' AND ')} THEN 1 ELSE 0 END`,
          )
          .bind(key, ...values),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
      )
      predicates = []
      values = []
    }
    for (const check of this.checks) {
      const bound = [...check.values, ...check.same.map((name) => check.snapshot[name] ?? null)]
      if (values.length + bound.length > 80 || predicates.length >= 12) flush()
      predicates.push(
        check.same.length
          ? `EXISTS(SELECT 1 FROM (${check.sql}) current WHERE ${check.same.map((name) => `current.${name} IS ?`).join(' AND ')})`
          : `NOT EXISTS(${check.sql})`,
      )
      values.push(...bound)
    }
    flush()
    return writes
  }
}
