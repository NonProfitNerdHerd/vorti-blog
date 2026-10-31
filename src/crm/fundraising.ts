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
      const extras = input.kind === 'funds' ? '' : ',currency=?,exponent=?,goal_minor=?'
      const args: Array<string | number | null> = [name, description, start, end, archived, now]
      if (input.kind !== 'funds') args.push(currency, exponent, goal)
      args.push(input.site, id, input.expectedRevision!)
      write = this.db
        .prepare(
          `UPDATE vc_crm_${input.kind} SET name=?,description=?,starts_on=?,ends_on=?,archived=?,updated_at=?,revision=revision+1${extras} WHERE site_id=? AND id=? AND revision=?`,
        )
        .bind(...args)
    } else {
      const columns = input.kind === 'funds' ? '' : ',currency,exponent,goal_minor',
        slots = input.kind === 'funds' ? '' : ',?,?,?'
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
      if (input.kind !== 'funds') args.push(currency, exponent, goal)
      write = this.db
        .prepare(
          `INSERT INTO vc_crm_${input.kind}(id,site_id,name,description,starts_on,ends_on,archived,created_at,updated_at${columns}) VALUES(?,?,?,?,?,?,?,?,?${slots})`,
        )
        .bind(...args)
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
}
