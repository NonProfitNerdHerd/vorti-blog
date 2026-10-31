import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import type { InformationCategory } from '../organizations/policy'

export type CRMOverview = {
  site: { id: string; name: string }
  asOf: string
  contacts: { total: number; donors: number; volunteers: number; donorVolunteers: number }
  received: null | {
    gifts: number
    currencies: Array<{ currency: string; exponent: number; minorUnits: string }>
  }
  followups: { opportunities: number | null; membershipRenewals: number | null }
}
const visibleContact = (alias: string) =>
  `EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.organization_id=a.organization_id WHERE a.site_id=${alias}.site_id AND a.constituent_id=${alias}.constituent_id AND a.archived=0 AND c.archived=0)`

/** Complete chapter aggregates. Monetary digit buckets avoid SQLite REAL and
 * 64-bit whole-amount overflow; only the small aggregate is returned to Worker. */
export async function crmOverview(
  db: D1Database,
  actor: number,
  siteID: string,
  today = new Date().toISOString().slice(0, 10),
  contact?: string,
): Promise<CRMOverview> {
  const authority = new OrganizationRepository(db, actor),
    site = await authority.require(siteID, 'identity', 'read')
  if (
    contact &&
    (contact.length > 80 ||
      !(await db
        .prepare(
          'SELECT 1 FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id WHERE a.site_id=? AND c.id=? AND a.archived=0 AND c.archived=0',
        )
        .bind(siteID, contact)
        .first()))
  )
    throw new SiteAccessError()
  const allowed = async (category: InformationCategory) => {
    try {
      const grant = await authority.require(siteID, category, 'read')
      if (grant.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
      return true
    } catch (error) {
      if (error instanceof SiteAccessError) return false
      throw error
    }
  }
  const finance = await allowed('finances'),
    opportunities = await allowed('restricted-activity'),
    memberships = await allowed('memberships')
  const contacts = await db
    .prepare(
      `SELECT coalesce(sum(c.kind='person'),0) AS total,
    coalesce(sum(EXISTS(SELECT 1 FROM json_each(a.roles) WHERE value='donor')),0) AS donors,
    coalesce(sum(EXISTS(SELECT 1 FROM json_each(a.roles) WHERE value='volunteer')),0) AS volunteers,
    coalesce(sum(EXISTS(SELECT 1 FROM json_each(a.roles) WHERE value='donor') AND EXISTS(SELECT 1 FROM json_each(a.roles) WHERE value='volunteer')),0) AS donorVolunteers
    FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.organization_id=a.organization_id WHERE a.site_id=? AND a.archived=0 AND c.archived=0${contact ? ' AND c.id=?' : ''}`,
    )
    .bind(siteID, ...(contact ? [contact] : []))
    .first<CRMOverview['contacts']>()
  let received: CRMOverview['received'] = null
  if (finance) {
    const result = await db
      .prepare(
        `WITH RECURSIVE positions(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM positions WHERE n<31),
      gifts AS MATERIALIZED (SELECT g.* FROM vc_crm_gifts g WHERE g.site_id=? AND g.state='posted' AND g.kind<>'in-kind' AND ${visibleContact('g')}${contact ? ' AND g.constituent_id=?' : ''})
      SELECT currency,exponent,n,CAST(sum(CAST(substr(net_minor,-n,1) AS INTEGER)) AS TEXT) AS digits,count(*) AS gifts
      FROM gifts JOIN positions ON n<=length(net_minor) GROUP BY currency,exponent,n ORDER BY currency,exponent,n`,
      )
      .bind(siteID, ...(contact ? [contact] : []))
      .all<{ currency: string; exponent: number; n: number; digits: string; gifts: number }>()
    const totals = new Map<string, { currency: string; exponent: number; minorUnits: string }>()
    let count = 0
    for (const row of result.results) {
      const key = `${row.currency}:${row.exponent}`,
        total = totals.get(key) ?? {
          currency: row.currency,
          exponent: row.exponent,
          minorUnits: '0',
        }
      total.minorUnits = (
        BigInt(total.minorUnits) +
        BigInt(row.digits) * 10n ** BigInt(row.n - 1)
      ).toString()
      totals.set(key, total)
      if (row.n === 1) count += row.gifts
    }
    received = { gifts: count, currencies: [...totals.values()] }
  }
  const due = opportunities
    ? await db
        .prepare(
          `SELECT count(*) AS n FROM vc_crm_opportunities o JOIN vc_crm_opportunity_stages s ON s.id=o.stage_id WHERE o.site_id=? AND o.archived=0 AND s.outcome='open' AND o.next_on<=? AND ${visibleContact('o')}${contact ? ' AND o.constituent_id=?' : ''}`,
        )
        .bind(siteID, today, ...(contact ? [contact] : []))
        .first<{ n: number }>()
    : null
  const through = new Date(`${today}T00:00:00Z`)
  through.setUTCDate(through.getUTCDate() + 30)
  const renewal = memberships
    ? await db
        .prepare(
          `SELECT count(*) AS n FROM vc_crm_membership_terms t WHERE t.site_id=? AND (? IS NULL OR t.billing_contact_id=? OR EXISTS(SELECT 1 FROM vc_crm_membership_coverage selected WHERE selected.term_id=t.id AND selected.constituent_id=?)) AND t.starts_on<=? AND t.ends_on BETWEEN ? AND ? AND (t.cancelled_on IS NULL OR t.cancelled_on>?) AND NOT EXISTS(SELECT 1 FROM vc_crm_membership_terms r WHERE r.renewed_from=t.id AND (r.cancelled_on IS NULL OR r.cancelled_on>?)) AND EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=t.site_id AND a.constituent_id=t.billing_contact_id AND a.archived=0) AND NOT EXISTS(SELECT 1 FROM vc_crm_membership_coverage cov WHERE cov.term_id=t.id AND NOT EXISTS(SELECT 1 FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0 WHERE a.site_id=t.site_id AND a.constituent_id=cov.constituent_id AND a.archived=0))`,
        )
        .bind(
          siteID,
          contact || null,
          contact || null,
          contact || null,
          today,
          today,
          through.toISOString().slice(0, 10),
          today,
          today,
        )
        .first<{ n: number }>()
    : null
  const epoch = await db
    .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
    .bind(site.organization_id)
    .first<{ authority_revision: number }>()
  if (epoch?.authority_revision !== site.authorityRevision) throw new SiteAccessError()
  if (
    contact &&
    !(await db
      .prepare(
        'SELECT 1 FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.organization_id=c.organization_id WHERE a.site_id=? AND c.id=? AND a.archived=0 AND c.archived=0',
      )
      .bind(siteID, contact)
      .first())
  )
    throw new SiteAccessError()
  return {
    site: { id: site.id, name: site.name },
    asOf: today,
    contacts: contacts!,
    received,
    followups: { opportunities: due?.n ?? null, membershipRenewals: renewal?.n ?? null },
  }
}
