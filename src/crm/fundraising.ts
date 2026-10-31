import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { calendarDate } from './finance'
import { assertMoney } from './money'
import { commitCRM, replayCRM } from './mutations'

export type ClassificationKind = 'campaigns' | 'funds' | 'appeals'
export interface Classification {
  id: string
  name: string
  description: string
  starts_on: string | null
  ends_on: string | null
  currency: string | null
  exponent: number | null
  goal_minor: string | null
  archived: number
  revision: number
  campaign_id?: string | null
  default_fund_id?: string | null
  status?: string
  channel?: string
  send_on?: string | null
  audience_version?: number
  internal_code?: string
}
export function classificationKind(value: string): ClassificationKind {
  if (!['campaigns', 'funds', 'appeals'].includes(value))
    throw new Error('Choose campaigns, funds or appeals.')
  return value as ClassificationKind
}
const text = (value: unknown, max: number, required = false) => {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    throw new Error('Enter a valid fundraising value.')
  return value.trim()
}
export function appealEligibility(rawProfile: string, channel: string): string {
  const profile = JSON.parse(rawProfile) as { deceased?: boolean; doNotContact?: boolean; communication?: Record<string, boolean>; methods?: Array<{ kind: string; value: string; primary: boolean }>; addresses?: Array<{ lines: string }> }
  if (profile.deceased) return 'Deceased'
  if (profile.doNotContact) return 'Do not contact'
  if (profile.communication?.[`${channel}Allowed`] === false) return 'Communication preference'
  const method = channel === 'mail' ? profile.addresses?.some(a => a.lines.trim()) : profile.methods?.some(m => m.kind === channel && m.primary)
  return method ? '' : channel === 'mail' ? 'No postal address' : 'No primary contact method'
}
export class FundraisingRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async fence(root: string, revision: number) {
    const row = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(root)
      .first<{ authority_revision: number }>()
    if (row?.authority_revision !== revision) throw new SiteAccessError()
  }
  async list(siteID: string, kind: ClassificationKind, after = '') {
    classificationKind(kind)
    const site = await this.authority.require(siteID, 'finances', 'read')
    const columns =
      kind === 'funds'
        ? 'id,name,description,starts_on,ends_on,NULL AS currency,NULL AS exponent,NULL AS goal_minor,archived,revision'
        : '*'
    const rows = await this.db
      .prepare(
        `SELECT ${columns} FROM vc_crm_${kind} WHERE site_id=? AND id>? ORDER BY id LIMIT 51`,
      )
      .bind(siteID, after)
      .all<Classification>()
    const canEdit = (await this.authority.authority(siteID, 'finances', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit,
    }
  }
  async get(siteID: string, kind: ClassificationKind, id: string) {
    classificationKind(kind)
    const site = await this.authority.require(siteID, 'finances', 'read')
    const columns = kind === 'funds'
      ? 'id,name,description,starts_on,ends_on,NULL AS currency,NULL AS exponent,NULL AS goal_minor,archived,revision'
      : '*'
    const doc = await this.db.prepare(`SELECT ${columns} FROM vc_crm_${kind} WHERE site_id=? AND id=?`).bind(siteID, id).first<Classification>()
    if (!doc) throw new SiteAccessError()
    await this.fence(site.organization_id, site.authorityRevision)
    return { doc }
  }
  async save(input: {
    site: string
    kind: ClassificationKind
    id?: string
    expectedRevision?: number
    operationKey: string
    values: Record<string, unknown>
  }) {
    classificationKind(input.kind)
    const site = await this.authority.require(input.site, 'finances', 'edit'),
      v = input.values
    const name = text(v.name, 180, true),
      description = text(v.description ?? '', 4000)
    const start = v.startsOn ? calendarDate(v.startsOn) : null,
      end = v.endsOn ? calendarDate(v.endsOn) : null
    if (end && start && end < start)
      throw new Error('Choose an end date on or after the start date.')
    const archived = v.archived === true ? 1 : 0
    const campaignID = input.kind === 'appeals' ? text(v.campaignId ?? '', 128) || null : null
    const defaultFundID = input.kind === 'appeals' ? text(v.defaultFundId ?? '', 128) || null : null
    const status = input.kind === 'appeals' ? text(v.status ?? 'draft', 32, true) : null
    const channel = input.kind === 'appeals' ? text(v.channel ?? 'email', 16, true) : null
    const sendOn = input.kind === 'appeals' && v.sendOn ? calendarDate(v.sendOn) : null
    const internalCode = input.kind === 'funds' ? text(v.internalCode ?? '', 60) : ''
    if (input.kind === 'appeals') {
      if (!['draft', 'planned', 'in_progress', 'completed', 'cancelled'].includes(status || '') || !['email', 'phone', 'mail'].includes(channel || ''))
        throw new Error('Choose a valid appeal status and channel.')
      if (!campaignID && !input.id) throw new Error('Select a campaign for the new appeal.')
      if (campaignID && !(await this.db.prepare('SELECT id FROM vc_crm_campaigns WHERE site_id=? AND id=? AND archived=0').bind(input.site, campaignID).first()))
        throw new SiteAccessError()
      if (defaultFundID && !(await this.db.prepare('SELECT id FROM vc_crm_funds WHERE site_id=? AND id=? AND archived=0').bind(input.site, defaultFundID).first()))
        throw new SiteAccessError()
      const outreach = input.id ? await this.db.prepare('SELECT 1 FROM vc_crm_appeal_outreach WHERE site_id=? AND appeal_id=? LIMIT 1').bind(input.site, input.id).first() : null
      if ((status === 'in_progress' || status === 'completed') && !outreach)
        throw new Error('Record actual outreach before marking an appeal in progress or completed.')
      if (outreach && (status === 'draft' || status === 'planned'))
        throw new Error('Outreach history is retained; this appeal cannot return to draft or planned.')
    }
    const fundIDs = input.kind === 'campaigns' && Array.isArray(v.fundIds) ? [...new Set(v.fundIds)] : null
    if (fundIDs && (fundIDs.length > 100 || fundIDs.some(id => typeof id !== 'string' || id.length > 128)))
      throw new Error('Choose valid linked funds.')
    for (const fundID of fundIDs || [])
      if (!(await this.db.prepare('SELECT id FROM vc_crm_funds WHERE site_id=? AND id=? AND archived=0').bind(input.site, fundID).first())) throw new SiteAccessError()
    const recipientIDs = input.kind === 'appeals' && Array.isArray(v.recipientIds) ? [...new Set(v.recipientIds)] : null
    if (recipientIDs && (recipientIDs.length > 500 || recipientIDs.some(id => typeof id !== 'string' || id.length > 128)))
      throw new Error('Choose up to 500 manual recipients.')
    const eligible: Array<{ id: string; eligible: number; reason: string }> = []
    if (recipientIDs) {
      await this.authority.require(input.site, 'communications', 'read')
      if (input.id) {
        const existing = await this.db.prepare('SELECT status FROM vc_crm_appeals WHERE id=? AND site_id=?').bind(input.id, input.site).first<{ status: string }>()
        const outreach = await this.db.prepare('SELECT 1 FROM vc_crm_appeal_outreach WHERE site_id=? AND appeal_id=? LIMIT 1').bind(input.site, input.id).first()
        if (!existing || existing.status !== 'draft' || status !== 'draft' || outreach)
          throw new Error('Recipient snapshots can only refresh while the appeal is a draft.')
      }
      for (const recipientID of recipientIDs) {
        const contact = await this.db.prepare(`SELECT c.profile,c.archived AS contact_archived,a.archived AS affiliation_archived FROM vc_crm_constituents c JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=? WHERE c.id=?`).bind(input.site, recipientID).first<{ profile: string; contact_archived: number; affiliation_archived: number }>()
        if (!contact) throw new SiteAccessError()
        if (contact.contact_archived || contact.affiliation_archived) continue
        const reason = appealEligibility(contact.profile, channel || 'email')
        eligible.push({ id: recipientID, eligible: reason ? 0 : 1, reason })
      }
    }
    let currency: string | null = null,
      exponent: number | null = null,
      goal: string | null = null
    if (input.kind !== 'funds' && v.goalMinor !== undefined && v.goalMinor !== '') {
      currency = text(v.currency, 3, true)
      goal = text(v.goalMinor, 40, true)
      exponent = Number(v.exponent)
      assertMoney({ currency, minorUnits: goal })
      if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4 || BigInt(goal) < 0n)
        throw new Error('Enter a valid goal and currency precision.')
    }
    const id = input.id || crypto.randomUUID(),
      now = new Date().toISOString()
    const intent = {
      kind: input.kind,
      id: input.id || null,
      expectedRevision: input.expectedRevision ?? null,
      name,
      description,
      start,
      end,
      archived,
      currency,
      exponent,
      goal,
      campaignID, defaultFundID, status, channel, sendOn, internalCode, fundIDs, recipientIDs,
    }
    const action = input.id ? 'classification.updated' : 'classification.created'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: input.kind,
      intent,
    })
    if (replay) return replay
    let before: Classification | null = null,
      write: D1PreparedStatement
    if (input.id) {
      if (!Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
      before = await this.db
        .prepare(`SELECT * FROM vc_crm_${input.kind} WHERE site_id=? AND id=?`)
        .bind(input.site, id)
        .first<Classification>()
      if (!before) throw new SiteAccessError()
      const extras = input.kind === 'funds' ? ',internal_code=?' : input.kind === 'appeals' ? ',currency=?,exponent=?,goal_minor=?,campaign_id=?,default_fund_id=?,status=?,channel=?,send_on=?' : ',currency=?,exponent=?,goal_minor=?'
      const args: Array<string | number | null> = [name, description, start, end, archived, now]
      if (input.kind === 'funds') args.push(internalCode)
      else args.push(currency, exponent, goal)
      if (input.kind === 'appeals') args.push(campaignID, defaultFundID, status, channel, sendOn)
      args.push(input.site, id, input.expectedRevision!)
      write = this.db
        .prepare(
          `UPDATE vc_crm_${input.kind} SET name=?,description=?,starts_on=?,ends_on=?,archived=?,updated_at=?,revision=revision+1${extras} WHERE site_id=? AND id=? AND revision=?`,
        )
        .bind(...args)
    } else {
      const columns = input.kind === 'funds' ? ',internal_code' : input.kind === 'appeals' ? ',currency,exponent,goal_minor,campaign_id,default_fund_id,status,channel,send_on' : ',currency,exponent,goal_minor',
        slots = input.kind === 'funds' ? ',?' : input.kind === 'appeals' ? ',?,?,?,?,?,?,?,?' : ',?,?,?'
      const args: Array<string | number | null> = [
        id,
        input.site,
        name,
        description,
        start,
        end,
        archived,
        now,
        now,
      ]
      if (input.kind === 'funds') args.push(internalCode)
      else args.push(currency, exponent, goal)
      if (input.kind === 'appeals') args.push(campaignID, defaultFundID, status, channel, sendOn)
      write = this.db
        .prepare(
          `INSERT INTO vc_crm_${input.kind}(id,site_id,name,description,starts_on,ends_on,archived,created_at,updated_at${columns}) VALUES(?,?,?,?,?,?,?,?,?${slots})`,
        )
        .bind(...args)
    }
    const dependent: D1PreparedStatement[] = []
    if (fundIDs) {
      dependent.push(this.db.prepare('DELETE FROM vc_crm_campaign_funds WHERE site_id=? AND campaign_id=?').bind(input.site, id))
      for (const fundID of fundIDs) dependent.push(this.db.prepare('INSERT INTO vc_crm_campaign_funds(site_id,campaign_id,fund_id,created_at) VALUES(?,?,?,?)').bind(input.site, id, fundID, now))
    }
    if (recipientIDs) {
      const audienceID = crypto.randomUUID()
      dependent.push(this.db.prepare('UPDATE vc_crm_appeals SET audience_version=audience_version+1 WHERE site_id=? AND id=?').bind(input.site, id))
      dependent.push(this.db.prepare('INSERT INTO vc_crm_appeal_audiences(id,site_id,appeal_id,version,source,source_report,created_by,created_at) SELECT ?,?,?,audience_version,\'manual\',NULL,?,? FROM vc_crm_appeals WHERE id=? AND site_id=?').bind(audienceID, input.site, id, this.actor, now, id, input.site))
      for (const recipient of eligible) dependent.push(this.db.prepare('INSERT INTO vc_crm_appeal_recipients(audience_id,constituent_id,eligible,exclusion) VALUES(?,?,?,?)').bind(audienceID, recipient.id, recipient.eligible, recipient.reason))
    }
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: input.kind,
      id,
      before,
      after: intent,
      intent,
      write,
      dependent,
      result: { id },
    })
  }
  async linkedGifts(siteID: string, kind: ClassificationKind, id: string, after = '') {
    classificationKind(kind)
    const site = await this.authority.require(siteID, 'finances', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    const exists = await this.db
      .prepare(`SELECT id FROM vc_crm_${kind} WHERE id=? AND site_id=?`)
      .bind(id, siteID)
      .first()
    if (!exists) throw new SiteAccessError()
    const match =
      kind === 'funds'
        ? `EXISTS(SELECT 1 FROM json_each(g.net_allocations) a WHERE json_extract(a.value,'$.fund')=?)`
        : `EXISTS(SELECT 1 FROM vc_crm_gift_attribution a WHERE a.gift_id=g.id AND a.${kind === 'campaigns' ? 'campaign_id' : 'appeal_id'}=?)`
    const rows = await this.db
      .prepare(
        `SELECT g.id,c.label,g.currency,g.exponent,g.net_minor,g.kind,g.state,g.received_on FROM vc_crm_gifts g
      JOIN vc_crm_constituents c ON c.id=g.constituent_id JOIN vc_crm_affiliations f ON f.constituent_id=c.id AND f.site_id=g.site_id AND f.archived=0
      WHERE g.site_id=? AND g.id>? AND ${match} ORDER BY g.id LIMIT 51`,
      )
      .bind(siteID, after, id)
      .all()
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? String(rows.results[49].id) : null,
    }
  }
  async attribute(input: {
    site: string
    gift: string
    campaign: string | null
    appeal: string | null
    expectedRevision: number
    reason: string
    operationKey: string
  }) {
    const site = await this.authority.require(input.site, 'finances', 'edit')
    const gift = await this.db
      .prepare('SELECT id FROM vc_crm_gifts WHERE id=? AND site_id=?')
      .bind(input.gift, input.site)
      .first()
    if (!gift) throw new SiteAccessError()
    if (input.appeal) {
      const appeal = await this.db.prepare('SELECT campaign_id FROM vc_crm_appeals WHERE id=? AND site_id=?').bind(input.appeal, input.site).first<{ campaign_id: string | null }>()
      if (!appeal || !appeal.campaign_id || appeal.campaign_id !== input.campaign)
        throw new Error('Choose the campaign linked to this appeal, or clear the appeal.')
    }
    const before = await this.db
      .prepare('SELECT * FROM vc_crm_gift_attribution WHERE gift_id=?')
      .bind(input.gift)
      .first<{ revision: number }>()
    const intent = {
      gift: input.gift,
      campaign: input.campaign,
      appeal: input.appeal,
      expectedRevision: input.expectedRevision,
      reason: text(input.reason, 1000, true),
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'gift.attributed',
      type: 'gift-attribution',
      intent,
    })
    if (replay) return replay
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision !== (before?.revision ?? 0)
    )
      throw new SiteConflictError()
    const write = before
      ? this.db
          .prepare(
            'UPDATE vc_crm_gift_attribution SET campaign_id=?,appeal_id=?,revision=revision+1 WHERE gift_id=? AND revision=?',
          )
          .bind(input.campaign, input.appeal, input.gift, input.expectedRevision)
      : this.db
          .prepare(
            'INSERT INTO vc_crm_gift_attribution(gift_id,campaign_id,appeal_id) VALUES(?,?,?)',
          )
          .bind(input.gift, input.campaign, input.appeal)
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'gift.attributed',
      type: 'gift-attribution',
      id: input.gift,
      before,
      after: intent,
      intent,
      reason: intent.reason,
      write,
      result: { id: input.gift, revision: input.expectedRevision + 1 },
    })
  }
  async attribution(siteID: string, gift: string) {
    const site = await this.authority.require(siteID, 'finances', 'read')
    const exists = await this.db
      .prepare('SELECT id FROM vc_crm_gifts WHERE site_id=? AND id=?')
      .bind(siteID, gift)
      .first()
    if (!exists) throw new SiteAccessError()
    const row = await this.db
      .prepare(
        `SELECT a.campaign_id,a.appeal_id,a.revision,c.name AS campaign_name,p.name AS appeal_name
      FROM vc_crm_gift_attribution a LEFT JOIN vc_crm_campaigns c ON c.id=a.campaign_id LEFT JOIN vc_crm_appeals p ON p.id=a.appeal_id WHERE a.gift_id=?`,
      )
      .bind(gift)
      .first<{
        campaign_id: string | null
        appeal_id: string | null
        revision: number
        campaign_name: string | null
        appeal_name: string | null
      }>()
    const canEdit = (await this.authority.authority(siteID, 'finances', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      doc: row || {
        campaign_id: null,
        appeal_id: null,
        campaign_name: null,
        appeal_name: null,
        revision: 0,
      },
      canEdit,
    }
  }
  async recordOutreach(input: { site: string; appeal: string; expectedRevision: number; notes: string; occurredAt: string; operationKey: string }) {
    const site = await this.authority.require(input.site, 'finances', 'edit')
    await this.authority.require(input.site, 'communications', 'edit')
    const appeal = await this.db.prepare('SELECT * FROM vc_crm_appeals WHERE id=? AND site_id=?').bind(input.appeal, input.site).first<Classification>()
    if (!appeal || appeal.archived || !['draft','planned','in_progress'].includes(appeal.status || '') || !Number.isSafeInteger(input.expectedRevision) || appeal.revision !== input.expectedRevision)
      throw new SiteConflictError()
    const date = new Date(input.occurredAt)
    if (!Number.isFinite(date.valueOf()) || date.valueOf() > Date.now()) throw new Error('Enter an outreach date that has occurred.')
    const notes = text(input.notes, 2000, true)
    const audience = await this.db.prepare('SELECT id FROM vc_crm_appeal_audiences WHERE appeal_id=? AND site_id=? AND version=?').bind(input.appeal, input.site, appeal.audience_version || 0).first<{ id: string }>()
    if (!audience) throw new Error('Choose an appeal audience before recording outreach.')
    const channel = appeal.channel || 'email'
    const method = channel === 'mail'
      ? `EXISTS(SELECT 1 FROM json_each(c.profile,'$.addresses') address WHERE trim(coalesce(json_extract(address.value,'$.lines'),''))<>'')`
      : `EXISTS(SELECT 1 FROM json_each(c.profile,'$.methods') method WHERE json_extract(method.value,'$.kind')='${channel}' AND json_extract(method.value,'$.primary')=1)`
    const eligibleSQL = `SELECT count(*) AS n FROM vc_crm_appeal_recipients r JOIN vc_crm_affiliations affiliation ON affiliation.constituent_id=r.constituent_id AND affiliation.site_id=? AND affiliation.archived=0 JOIN vc_crm_constituents c ON c.id=r.constituent_id AND c.archived=0 WHERE r.audience_id=? AND r.eligible=1 AND json_extract(c.profile,'$.deceased') IS NOT 1 AND json_extract(c.profile,'$.doNotContact') IS NOT 1 AND json_extract(c.profile,'$.communication.${channel}Allowed') IS NOT 0 AND ${method}`
    const selected = await this.db.prepare('SELECT count(*) AS n FROM vc_crm_appeal_recipients WHERE audience_id=? AND eligible=1').bind(audience.id).first<{ n: number }>()
    if (!selected?.n) throw new Error('This appeal has no eligible recipients.')
    const current = await this.db.prepare(eligibleSQL).bind(input.site, audience.id).first<{ n: number }>()
    if (current?.n !== selected.n) throw new Error('Contact eligibility changed. Refresh the draft audience before recording outreach.')
    const intent = { appeal: input.appeal, expectedRevision: input.expectedRevision, notes, occurredAt: date.toISOString(), audience: audience.id, recipients: selected.n }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, { site: input.site, action: 'appeal.outreach.recorded', type: 'appeal-outreach', intent })
    if (replay) return replay
    const id = crypto.randomUUID(), now = new Date().toISOString()
    return commitCRM({
      db: this.db, actor: this.actor, key: input.operationKey, site: input.site, organization: site.organization_id, authorityRevision: site.authorityRevision,
      action: 'appeal.outreach.recorded', type: 'appeal-outreach', id, before: appeal, after: intent, intent,
      write: this.db.prepare("UPDATE vc_crm_appeals SET status='in_progress',revision=revision+1,updated_at=? WHERE site_id=? AND id=? AND revision=?").bind(now, input.site, input.appeal, input.expectedRevision),
      dependent: [
        this.db.prepare(`INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,CASE WHEN n=? THEN 1 ELSE 0 END FROM (${eligibleSQL})`).bind(`${input.operationKey}:eligibility`, selected.n, input.site, audience.id),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${input.operationKey}:eligibility`),
        this.db.prepare('INSERT INTO vc_crm_appeal_outreach(id,site_id,appeal_id,audience_id,channel,recipient_count,notes,recorded_by,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, input.site, input.appeal, audience.id, channel, selected.n, notes, this.actor, date.toISOString()),
      ], result: { id },
    })
  }
}
