import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { appealEligibility, type Classification } from './fundraising'

type MoneyTotal = { currency: string; exponent: number; minor: string }
type GiftRow = { id: string; constituent_id: string; label: string; currency: string; exponent: number; net_minor: string; net_allocations: string; received_on: string; campaign_id: string | null; appeal_id: string | null }
type PledgeRow = { id: string; campaign_id: string; currency: string; exponent: number; amount_minor: string }
const key = (currency: string, exponent: number) => `${currency}:${exponent}`
function totals(map: Map<string, bigint>): MoneyTotal[] {
  return [...map].map(([code, amount]) => {
    const [currency, exponent] = code.split(':')
    return { currency, exponent: Number(exponent), minor: amount.toString() }
  }).sort((a, b) => a.currency.localeCompare(b.currency))
}
function add(map: Map<string, bigint>, currency: string, exponent: number, minor: string) {
  const k = key(currency, exponent)
  map.set(k, (map.get(k) || 0n) + BigInt(minor))
}
export class FundraisingReport {
  constructor(private db: D1Database, private actor: number) {}
  private async scope(site: string) {
    return new OrganizationRepository(this.db, this.actor).require(site, 'finances', 'read')
  }
  async load(siteID: string) {
    const site = await this.scope(siteID)
    const authority = new OrganizationRepository(this.db, this.actor)
    const canEdit = (await authority.authority(siteID, 'finances', 'edit')).allowed
    const canRecordOutreach = canEdit && (await authority.authority(siteID, 'communications', 'edit')).allowed
    const canSeeNames = (await authority.authority(siteID, 'identity', 'read')).allowed
    const canSeeAudience = (await authority.authority(siteID, 'communications', 'read')).allowed
    const [campaigns, appeals, funds, links, audienceCounts, giftRows, pledgeRows, applications, outreach, activity] = await Promise.all([
      this.db.prepare('SELECT * FROM vc_crm_campaigns WHERE site_id=? ORDER BY name,id').bind(siteID).all<Classification>(),
      this.db.prepare('SELECT * FROM vc_crm_appeals WHERE site_id=? ORDER BY name,id').bind(siteID).all<Classification>(),
      this.db.prepare(`SELECT id,name,description,starts_on,ends_on,NULL AS currency,NULL AS exponent,NULL AS goal_minor,archived,revision,internal_code FROM vc_crm_funds WHERE site_id=? ORDER BY name,id`).bind(siteID).all<Classification>(),
      this.db.prepare('SELECT campaign_id,fund_id FROM vc_crm_campaign_funds WHERE site_id=?').bind(siteID).all<{ campaign_id: string; fund_id: string }>(),
      canSeeAudience ? this.db.prepare(`SELECT audience.appeal_id,count(*) AS selected,sum(recipient.eligible) AS eligible FROM vc_crm_appeal_audiences audience JOIN vc_crm_appeals appeal ON appeal.id=audience.appeal_id AND appeal.audience_version=audience.version JOIN vc_crm_appeal_recipients recipient ON recipient.audience_id=audience.id WHERE audience.site_id=? GROUP BY audience.appeal_id`).bind(siteID).all<{ appeal_id: string; selected: number; eligible: number }>() : Promise.resolve({ results: [] as Array<{ appeal_id: string; selected: number; eligible: number }> }),
      this.db.prepare(`SELECT g.id,g.constituent_id,c.label,g.currency,g.exponent,g.net_minor,g.net_allocations,g.received_on,a.campaign_id,a.appeal_id FROM vc_crm_gifts g LEFT JOIN vc_crm_gift_attribution a ON a.gift_id=g.id JOIN vc_crm_constituents c ON c.id=g.constituent_id WHERE g.site_id=? AND g.state='posted' AND g.kind<>'in-kind' AND g.net_minor<>'0' ORDER BY g.received_on DESC,g.id DESC`).bind(siteID).all<GiftRow>(),
      this.db.prepare(`SELECT p.id,p.campaign_id,p.currency,p.exponent,p.amount_minor FROM vc_crm_commitments p WHERE p.site_id=? AND p.kind='pledge' AND p.state<>'cancelled' AND p.campaign_id IS NOT NULL`).bind(siteID).all<PledgeRow>(),
      this.db.prepare(`SELECT app.commitment_id,app.amount_minor FROM vc_crm_giving_applications app JOIN vc_crm_commitments pledge ON pledge.id=app.commitment_id AND pledge.site_id=? AND pledge.kind='pledge' JOIN vc_crm_gifts gift ON gift.id=app.gift_id AND gift.state='posted' WHERE app.reversed=0`).bind(siteID).all<{ commitment_id: string; amount_minor: string }>(),
      this.db.prepare('SELECT id,appeal_id,channel,recipient_count,notes,occurred_at FROM vc_crm_appeal_outreach WHERE site_id=? ORDER BY occurred_at DESC,id DESC').bind(siteID).all<{ id: string; appeal_id: string; channel: string; recipient_count: number; notes: string; occurred_at: string }>(),
      this.db.prepare("SELECT record_type,record_id,action,created_at FROM vc_platform_audit WHERE site_id=? AND record_type IN('campaigns','appeals','funds','appeal-outreach','gift-attribution') ORDER BY created_at DESC LIMIT 100").bind(siteID).all<{ record_type: string; record_id: string; action: string; created_at: string }>(),
    ])
    const byCampaign = new Map<string, Map<string, bigint>>()
    const byAppeal = new Map<string, Map<string, bigint>>()
    const byFund = new Map<string, Map<string, bigint>>()
    const overall = new Map<string, bigint>()
    const gifts = giftRows.results.map(g => {
      add(overall, g.currency, g.exponent, g.net_minor)
      if (g.campaign_id) { const total = byCampaign.get(g.campaign_id) || new Map(); add(total, g.currency, g.exponent, g.net_minor); byCampaign.set(g.campaign_id, total) }
      if (g.appeal_id) { const total = byAppeal.get(g.appeal_id) || new Map(); add(total, g.currency, g.exponent, g.net_minor); byAppeal.set(g.appeal_id, total) }
      const giftFunds: Array<{ id: string; minor: string }> = []
      try {
        for (const allocation of JSON.parse(g.net_allocations) as Array<{ fund: string; minorUnits: string }>) {
          const total = byFund.get(allocation.fund) || new Map()
          add(total, g.currency, g.exponent, allocation.minorUnits)
          byFund.set(allocation.fund, total)
          giftFunds.push({ id: allocation.fund, minor: allocation.minorUnits })
        }
      } catch { /* Historical malformed allocation is omitted from fund totals, not invented. */ }
      return { id: g.id, label: canSeeNames ? g.label : 'Donor', currency: g.currency, exponent: g.exponent, net_minor: g.net_minor, received_on: g.received_on, campaign_id: g.campaign_id, appeal_id: g.appeal_id, funds: giftFunds }
    })
    const outstanding = new Map<string, Map<string, bigint>>()
    for (const pledge of pledgeRows.results) {
      const paid = applications.results.filter(app => app.commitment_id === pledge.id).reduce((total, app) => total + BigInt(app.amount_minor), 0n)
      const remaining = BigInt(pledge.amount_minor) - paid
      if (remaining <= 0n) continue
      const total = outstanding.get(pledge.campaign_id) || new Map()
      add(total, pledge.currency, pledge.exponent, remaining.toString())
      outstanding.set(pledge.campaign_id, total)
    }
    const counts = new Map(audienceCounts.results.map(row => [row.appeal_id, row]))
    const campaignDocs = campaigns.results.map(c => ({ ...c, received: totals(byCampaign.get(c.id) || new Map()), outstanding: totals(outstanding.get(c.id) || new Map()), appealCount: appeals.results.filter(a => a.campaign_id === c.id).length, fundCount: links.results.filter(l => l.campaign_id === c.id).length }))
    const appealDocs = appeals.results.map(a => ({ ...a, received: totals(byAppeal.get(a.id) || new Map()), audience: counts.get(a.id) || { selected: 0, eligible: 0 } }))
    const fundDocs = funds.results.map(f => ({ ...f, received: totals(byFund.get(f.id) || new Map()), campaignCount: links.results.filter(l => l.fund_id === f.id).length }))
    const current = canSeeAudience ? await this.db.prepare(`SELECT recipient.audience_id,recipient.constituent_id,recipient.eligible,recipient.exclusion,audience.appeal_id,c.label FROM vc_crm_appeal_recipients recipient JOIN vc_crm_appeal_audiences audience ON audience.id=recipient.audience_id JOIN vc_crm_appeals appeal ON appeal.id=audience.appeal_id AND appeal.audience_version=audience.version JOIN vc_crm_constituents c ON c.id=recipient.constituent_id WHERE audience.site_id=?`).bind(siteID).all<{ constituent_id: string; eligible: number; exclusion: string; appeal_id: string; label: string }>() : { results: [] as Array<{ constituent_id: string; eligible: number; exclusion: string; appeal_id: string; label: string }> }
    const revision = await this.db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').bind(site.organization_id).first<{ authority_revision: number }>()
    if (revision?.authority_revision !== site.authorityRevision) throw new SiteAccessError()
    return { campaigns: campaignDocs, appeals: appealDocs, funds: fundDocs, links: links.results, gifts, totals: totals(overall), recipients: current.results.map(r => ({ ...r, label: canSeeNames ? r.label : 'Recipient' })), outreach: canSeeAudience ? outreach.results : [], activity: activity.results, canEdit, canRecordOutreach, canSeeNames, canSeeAudience, asOf: new Date().toISOString().slice(0, 10) }
  }
  async candidates(siteID: string, search: string) {
    const authority = new OrganizationRepository(this.db, this.actor)
    const site = await authority.require(siteID, 'communications', 'read')
    await authority.require(siteID, 'identity', 'read')
    if (search.length > 100) throw new Error('Use a shorter contact search.')
    const docs = await this.db.prepare(`SELECT c.id,c.label,c.profile FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? AND a.archived=0 WHERE c.archived=0 AND c.label LIKE ? ESCAPE '\\' ORDER BY c.label,c.id LIMIT 100`).bind(siteID, `%${search.replace(/[\\%_]/g, '\\$&')}%`).all<{ id: string; label: string; profile: string }>()
    const revision = await this.db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').bind(site.organization_id).first<{ authority_revision: number }>()
    if (revision?.authority_revision !== site.authorityRevision) throw new SiteAccessError()
    return { docs: docs.results.map(d => ({ id: d.id, label: d.label })) }
  }
  async previewAudience(siteID: string, appealID: string) {
    const authority = new OrganizationRepository(this.db, this.actor)
    const site = await authority.require(siteID, 'finances', 'edit')
    await authority.require(siteID, 'communications', 'read')
    await authority.require(siteID, 'identity', 'read')
    const appeal = await this.db.prepare('SELECT channel,status,audience_version FROM vc_crm_appeals WHERE id=? AND site_id=?').bind(appealID, siteID).first<{ channel: string; status: string; audience_version: number }>()
    if (!appeal || appeal.status !== 'draft') throw new SiteAccessError()
    const docs = await this.db.prepare(`SELECT recipient.constituent_id,recipient.eligible,recipient.exclusion,contact.label,contact.profile,contact.archived AS contact_archived,affiliation.archived AS affiliation_archived FROM vc_crm_appeal_recipients recipient JOIN vc_crm_appeal_audiences audience ON audience.id=recipient.audience_id AND audience.appeal_id=? AND audience.site_id=? AND audience.version=? JOIN vc_crm_constituents contact ON contact.id=recipient.constituent_id JOIN vc_crm_affiliations affiliation ON affiliation.constituent_id=contact.id AND affiliation.site_id=audience.site_id WHERE recipient.audience_id=audience.id`).bind(appealID, siteID, appeal.audience_version).all<{ constituent_id: string; eligible: number; exclusion: string; label: string; profile: string; contact_archived: number; affiliation_archived: number }>()
    const changes = docs.results.map(row => {
      const reason = row.contact_archived || row.affiliation_archived ? 'No longer active' : appealEligibility(row.profile, appeal.channel)
      return { id: row.constituent_id, label: row.label, before: row.eligible ? 'Eligible' : row.exclusion, after: reason || 'Eligible' }
    }).filter(row => row.before !== row.after)
    const revision = await this.db.prepare('SELECT authority_revision FROM vc_organizations WHERE id=?').bind(site.organization_id).first<{ authority_revision: number }>()
    if (revision?.authority_revision !== site.authorityRevision) throw new SiteAccessError()
    return { changes, selected: docs.results.filter(row => !row.contact_archived && !row.affiliation_archived).length, eligible: docs.results.filter(row => !row.contact_archived && !row.affiliation_archived && !appealEligibility(row.profile, appeal.channel)).length }
  }
}
