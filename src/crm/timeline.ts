import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import type { InformationCategory } from '../organizations/policy'
import {
  timelineGroups,
  type TimelineGroup,
  type TimelineEvent,
  type TimelineCursor,
} from './timeline-model'
import { timelineSources } from './timeline-sources'
import { documentAmount } from './correspondence-giving'

type Row = {
  id: string
  at: string
  kind: TimelineGroup
  title: string
  label: string
  detail: string | null
  effective_on: string | null
  target_type: string
  target_id: string
  minor: string | null
  currency: string | null
  exponent: number | null
  money_role: TimelineEvent['moneyRole']
}
export class ContactTimeline {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async context(siteID: string, contact: string) {
    const site = await this.authority.require(siteID, 'identity', 'read')
    const row = await this.db
      .prepare(
        `SELECT c.id FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id
      WHERE c.id=? AND a.site_id=? AND c.archived=0 AND a.archived=0`,
      )
      .bind(contact, siteID)
      .first()
    if (!row) throw new SiteAccessError()
    return site
  }
  async list(input: { site: string; contact: string; group?: string; before?: TimelineCursor }) {
    const site = await this.context(input.site, input.contact)
    if (input.group && !(timelineGroups as readonly string[]).includes(input.group))
      throw new Error('Choose a valid timeline group.')
    if (input.before) {
      const date = new Date(input.before.date)
      if (
        (input.before.date !== '' &&
          (!Number.isFinite(date.getTime()) || date.toISOString() !== input.before.date)) ||
        typeof input.before.id !== 'string' ||
        !input.before.id ||
        input.before.id.length > 256
      )
        throw new Error('Invalid page cursor.')
      if (input.before.revision !== site.authorityRevision) throw new SiteConflictError()
    }
    const read = new Set<InformationCategory>(['identity'])
    for (const category of [
      'affiliations',
      'finances',
      'memberships',
      'volunteer-experience',
      'volunteer-hours',
      'communications',
      'restricted-activity',
    ] as const)
      if ((await this.authority.authority(input.site, category, 'read')).allowed) read.add(category)
    const built = timelineSources(read)
    const eventColumns = [
      'id',
      'at',
      'kind',
      'title',
      'label',
      'detail',
      'effective_on',
      'target_type',
      'target_id',
      'minor',
      'currency',
      'exponent',
      'money_role',
    ]
    // Native D1 accepts at most five terms in a compound SELECT. Materialized
    // groups keep each compound within that limit without limiting event rows.
    const compounds: string[] = []
    let selects = built.sources.map((source) => source.sql)
    while (selects.length > 5) {
      const next: string[] = []
      for (let index = 0; index < selects.length; index += 5) {
        const name = `timeline_part_${compounds.length}`
        compounds.push(
          `${name}(${eventColumns.join(',')}) AS MATERIALIZED (${selects.slice(index, index + 5).join(' UNION ALL ')})`,
        )
        next.push(`SELECT * FROM ${name}`)
      }
      selects = next
    }
    // Count and rows share one SQLite statement/snapshot, including an empty page after the last cursor.
    const sql = `WITH chosen AS (SELECT ? AS site_id,? AS contact_id,? AS actor_id), ${compounds.length ? `${compounds.join(',')},` : ''}
      events(${eventColumns.join(',')}) AS (${selects.join(' UNION ALL ')}),
      normalized AS (SELECT *,coalesce(strftime('%Y-%m-%dT%H:%M:%fZ',at),'') AS timestamp FROM events)
      SELECT * FROM normalized WHERE 1=1 ${input.group ? 'AND kind=?' : ''}`
    const params = [
      input.site,
      input.contact,
      this.actor,
      ...built.params,
      ...(input.group ? [input.group] : []),
    ]
    const columns = [
      'id',
      'at',
      'kind',
      'title',
      'label',
      'detail',
      'effective_on',
      'target_type',
      'target_id',
      'minor',
      'currency',
      'exponent',
      'money_role',
      'timestamp',
    ]
    const snapshot = await this.db
      .prepare(
        `WITH authorized AS (${sql}), page AS (SELECT * FROM authorized
        ${input.before ? 'WHERE (timestamp<? OR (timestamp=? AND id<?))' : ''} ORDER BY timestamp DESC,id DESC LIMIT 51)
        SELECT (SELECT count(*) FROM authorized) total,
        (SELECT json_group_array(json_object(${columns.map((column) => `'${column}',${column}`).join(',')})) FROM page) docs`,
      )
      .bind(
        ...params,
        ...(input.before ? [input.before.date, input.before.date, input.before.id] : []),
      )
      .first<{ total: number; docs: string }>()
    if (!snapshot) throw new Error('The contact timeline could not be loaded.')
    const rows = JSON.parse(snapshot.docs) as Array<Row & { timestamp: string }>
    const current = await this.context(input.site, input.contact)
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    const docs: TimelineEvent[] = rows.slice(0, 50).map((row) => ({
      id: row.id,
      at: row.timestamp || null,
      group: row.kind,
      title: row.title,
      label: row.label,
      detail: row.detail,
      effectiveOn: row.effective_on,
      targetType: row.target_type,
      targetID: row.target_id,
      amount:
        row.minor !== null && row.currency !== null && row.exponent !== null
          ? documentAmount(row.minor, row.currency, row.exponent)
          : null,
      moneyRole: row.minor === null ? null : row.money_role,
    }))
    return {
      docs,
      total: snapshot.total,
      groups: [...new Set(built.sources.map((s) => s.group))],
      next:
        rows.length > 50
          ? {
              date: rows[49].timestamp,
              id: rows[49].id,
              revision: site.authorityRevision,
            }
          : null,
    }
  }
}
