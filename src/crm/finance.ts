import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { assertMoney, validateAllocations, type Money } from './money'
import { commitCRM, replayCRM } from './mutations'

export type GiftKind = 'cash' | 'check' | 'external-online' | 'in-kind'
export interface GiftSummary {
  id: string
  constituent: string
  currency: string
  exponent: number
  originalMinor: string
  netMinor: string
  kind: GiftKind
  state: 'posted' | 'void'
  receivedOn: string
  revision: number
  reference: string
  notes: string
  allocations: Array<Money & { fund: string }>
  netAllocations: Array<Money & { fund: string }>
}
interface GiftRow {
  id: string
  constituent_id: string
  currency: string
  exponent: number
  original_minor: string
  net_minor: string
  kind: GiftKind
  state: 'posted' | 'void'
  received_on: string
  revision: number
  reference: string
  notes: string
  allocations: string
  net_allocations: string
}
const giftDTO = (row: GiftRow): GiftSummary => ({
  id: row.id,
  constituent: row.constituent_id,
  currency: row.currency,
  exponent: row.exponent,
  originalMinor: row.original_minor,
  netMinor: row.net_minor,
  kind: row.kind,
  state: row.state,
  receivedOn: row.received_on,
  revision: row.revision,
  reference: row.reference,
  notes: row.notes,
  allocations: JSON.parse(row.allocations),
  netAllocations: JSON.parse(row.net_allocations),
})
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    throw new Error('Enter a valid financial record value.')
  return value.trim()
}
export function calendarDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '9999-12-31' ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error('Choose a valid calendar date.')
  return value
}
/** Funds and gifts always belong to one chapter. Identity sharing never grants finance access. */
export class FinanceRepository {
  private readonly authority: OrganizationRepository
  constructor(
    private readonly db: D1Database,
    private readonly actor: number,
    private readonly commit: typeof commitCRM = commitCRM,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async readFence(root: string, revision: number): Promise<void> {
    const current = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(root)
      .first<{ authority_revision: number }>()
    if (current?.authority_revision !== revision) throw new SiteAccessError()
  }
  async funds(
    siteID: string,
    after?: { name: string; id: string },
  ): Promise<{
    docs: Array<{ id: string; name: string }>
    next: { name: string; id: string } | null
  }> {
    const site = await this.authority.require(siteID, 'finances', 'read')
    const parameters = [
      site.id,
      ...(after ? [text(after.name, 120, true), after.name, text(after.id, 80, true)] : []),
    ]
    const result = await this.db
      .prepare(
        `SELECT id,name FROM vc_crm_funds WHERE site_id=? AND archived=0 ${after ? 'AND (name>? OR(name=? AND id>?))' : ''} ORDER BY name,id LIMIT 101`,
      )
      .bind(...parameters)
      .all<{ id: string; name: string }>()
    await this.readFence(site.organization_id, site.authorityRevision)
    const docs = result.results.slice(0, 100)
    return { docs, next: result.results.length > 100 ? docs.at(-1)! : null }
  }
  async createFund(input: {
    site: string
    name: string
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const site = await this.authority.require(input.site, 'finances', 'configure')
    const name = text(input.name, 120, true),
      id = crypto.randomUUID(),
      now = new Date().toISOString()
    const intent = { name }
    return this.commit({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: site.id,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'fund.created',
      type: 'fund',
      id,
      after: { name },
      intent,
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_funds(id,site_id,name,created_at,updated_at) VALUES(?,?,?,?,?)',
        )
        .bind(id, site.id, name, now, now),
      result: { id, revision: 1 },
    })
  }
  async createGift(input: {
    site: string
    constituent: string
    amount: Money
    exponent: number
    kind: GiftKind
    receivedOn: string
    allocations: Array<Money & { fund: string }>
    reference?: string
    notes?: string
    campaign?: string
    appeal?: string
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const site = await this.authority.require(input.site, 'finances', 'edit')
    const identity = await this.authority.require(input.site, 'identity', 'read')
    if (identity.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    if (!input.amount || typeof input.amount !== 'object') throw new Error('Enter a gift amount.')
    assertMoney(input.amount)
    if (
      !Number.isInteger(input.exponent) ||
      input.exponent < 0 ||
      input.exponent > 4 ||
      !['cash', 'check', 'external-online', 'in-kind'].includes(input.kind)
    )
      throw new Error('Choose a valid gift type and currency precision.')
    if (
      !Array.isArray(input.allocations) ||
      input.allocations.length < 1 ||
      input.allocations.length > 20
    )
      throw new Error('Choose between one and twenty fund allocations.')
    validateAllocations(input.amount, input.allocations)
    const receivedOn = calendarDate(input.receivedOn),
      reference = text(input.reference || '', 250),
      notes = text(input.notes || '', 4000)
    const constituent = text(input.constituent, 80, true)
    const intent = {
      constituent,
      amount: input.amount,
      exponent: input.exponent,
      kind: input.kind,
      receivedOn,
      allocations: input.allocations,
      reference,
      notes,
      ...(input.campaign ? { campaign: input.campaign } : {}),
      ...(input.appeal ? { appeal: input.appeal } : {}),
    }
    const affiliation = await this.db
      .prepare(
        'SELECT id FROM vc_crm_affiliations WHERE site_id=? AND constituent_id=? AND archived=0',
      )
      .bind(site.id, constituent)
      .first()
    if (!affiliation) throw new SiteAccessError()
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: site.id,
      action: 'gift.created',
      type: 'gift',
      intent,
    })
    if (replay) return replay
    for (const allocation of input.allocations) {
      if (
        !(await this.db
          .prepare('SELECT id FROM vc_crm_funds WHERE id=? AND site_id=? AND archived=0')
          .bind(allocation.fund, site.id)
          .first())
      )
        throw new SiteAccessError()
    }
    // One site/currency always uses a single precision; do not reinterpret historical amounts.
    const previous = await this.db
      .prepare('SELECT exponent FROM vc_crm_gifts WHERE site_id=? AND currency=? LIMIT 1')
      .bind(site.id, input.amount.currency)
      .first<{ exponent: number }>()
    if (previous && previous.exponent !== input.exponent)
      throw new Error('Use the existing currency precision for this chapter.')
    const id = crypto.randomUUID(),
      now = new Date().toISOString()
    return this.commit({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: site.id,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'gift.created',
      type: 'gift',
      id,
      intent,
      after: intent,
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_gifts(id,site_id,constituent_id,currency,exponent,original_minor,net_minor,kind,received_on,reference,notes,allocations,net_allocations,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          site.id,
          constituent,
          input.amount.currency,
          input.exponent,
          input.amount.minorUnits,
          input.amount.minorUnits,
          input.kind,
          receivedOn,
          reference,
          notes,
          JSON.stringify(input.allocations),
          JSON.stringify(input.allocations),
          this.actor,
          now,
          now,
        ),
      dependent:
        input.campaign || input.appeal
          ? [
              this.db
                .prepare(
                  'INSERT INTO vc_crm_gift_attribution(gift_id,campaign_id,appeal_id) VALUES(?,?,?)',
                )
                .bind(id, input.campaign || null, input.appeal || null),
            ]
          : [],
      result: { id, revision: 1 },
    })
  }
  private async row(site: string, id: string): Promise<GiftRow> {
    const row = await this.db
      .prepare('SELECT * FROM vc_crm_gifts WHERE site_id=? AND id=?')
      .bind(site, id)
      .first<GiftRow>()
    if (!row) throw new SiteAccessError()
    return row
  }
  async list(input: {
    site: string
    constituent?: string
    page?: number
    limit?: number
  }): Promise<{
    docs: GiftSummary[]
    total: number
    page: number
    limit: number
    canEdit: boolean
    canConfigure: boolean
  }> {
    const site = await this.authority.require(input.site, 'finances', 'read')
    const page = input.page ?? 1,
      limit = input.limit ?? 50
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Choose a valid page and row limit.')
    const where = `site_id=?${input.constituent ? ' AND constituent_id=?' : ''}`
    const parameters = [site.id, ...(input.constituent ? [text(input.constituent, 80, true)] : [])]
    const total = await this.db
      .prepare(`SELECT count(*) AS total FROM vc_crm_gifts WHERE ${where}`)
      .bind(...parameters)
      .first<{ total: number }>()
    const rows = await this.db
      .prepare(
        `SELECT * FROM vc_crm_gifts WHERE ${where} ORDER BY received_on DESC,id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...parameters, limit, (page - 1) * limit)
      .all<GiftRow>()
    const canEdit = (await this.authority.authority(site.id, 'finances', 'edit')).allowed
    const canConfigure = (await this.authority.authority(site.id, 'finances', 'configure')).allowed
    await this.readFence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.map(giftDTO),
      total: total?.total || 0,
      page,
      limit,
      canEdit,
      canConfigure,
    }
  }
  async get(
    siteID: string,
    id: string,
    page = 1,
  ): Promise<
    GiftSummary & {
      adjustments: Array<Record<string, unknown>>
      adjustmentTotal: number
      adjustmentPage: number
      canEdit: boolean
    }
  > {
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new Error('Choose a valid history page.')
    const site = await this.authority.require(siteID, 'finances', 'read'),
      row = await this.row(site.id, id)
    const count = await this.db
      .prepare('SELECT count(*) AS total FROM vc_crm_gift_adjustments WHERE gift_id=?')
      .bind(id)
      .first<{ total: number }>()
    const adjustments = (
      await this.db
        .prepare(
          "SELECT a.id,a.action,a.delta_minor AS deltaMinor,a.reason,COALESCE(u.attribution_label,'Account #'||a.actor_id) AS actorLabel,a.created_at AS createdAt FROM vc_crm_gift_adjustments a JOIN users u ON u.id=a.actor_id WHERE a.gift_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 50 OFFSET ?",
        )
        .bind(id, (page - 1) * 50)
        .all<Record<string, unknown>>()
    ).results
    const canEdit = (await this.authority.authority(site.id, 'finances', 'edit')).allowed
    await this.readFence(site.organization_id, site.authorityRevision)
    return {
      ...giftDTO(row),
      adjustments,
      adjustmentTotal: count?.total || 0,
      adjustmentPage: page,
      canEdit,
    }
  }
  async adjust(input: {
    site: string
    id: string
    action: 'refund' | 'correction' | 'void'
    deltaMinor: string
    allocations?: Array<Money & { fund: string }>
    reason: string
    expectedRevision: number
    operationKey: string
  }): Promise<Record<string, unknown>> {
    const site = await this.authority.require(input.site, 'finances', 'edit')
    if (
      !['refund', 'correction', 'void'].includes(input.action) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    )
      throw new Error('Choose a valid financial adjustment.')
    const id = text(input.id, 80, true),
      reason = text(input.reason, 2000, true)
    const intent = {
      id,
      action: input.action,
      deltaMinor: input.deltaMinor,
      allocations: input.allocations,
      reason,
      expectedRevision: input.expectedRevision,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: site.id,
      type: 'gift',
      action: 'gift.adjusted',
      intent,
    })
    if (replay) return replay
    const row = await this.row(site.id, id)
    if (row.state !== 'posted') throw new Error('This record was voided; its history is retained.')
    if (row.kind === 'in-kind' && input.action === 'refund')
      throw new Error('Use a correction for an in-kind estimate; it is not a cash refund.')
    assertMoney({ currency: row.currency, minorUnits: input.deltaMinor })
    const delta = BigInt(input.deltaMinor),
      net = BigInt(row.net_minor) + delta
    if (
      (input.action === 'refund' && delta >= 0n) ||
      (input.action === 'correction' && delta === 0n) ||
      (input.action === 'void' && delta !== 0n) ||
      net < 0n
    )
      throw new Error('Enter an adjustment that leaves a nonnegative gift balance.')
    assertMoney({ currency: row.currency, minorUnits: net.toString() })
    const currentAllocations = JSON.parse(row.net_allocations) as Array<Money & { fund: string }>
    const adjustments =
      input.action === 'void'
        ? []
        : (input.allocations ??
          (currentAllocations.length === 1
            ? [{ ...currentAllocations[0], minorUnits: input.deltaMinor }]
            : []))
    if (input.action !== 'void' && (!adjustments.length || adjustments.length > 20))
      throw new Error('Choose fund allocation changes for this adjustment.')
    let allocatedDelta = 0n
    const seen = new Set<string>(),
      nextAllocations = currentAllocations.map((item) => ({ ...item }))
    for (const allocation of adjustments) {
      assertMoney(allocation)
      const target = nextAllocations.find((item) => item.fund === allocation.fund)
      if (!target || seen.has(allocation.fund) || allocation.currency !== row.currency)
        throw new Error('Choose each original fund once in the gift currency.')
      seen.add(allocation.fund)
      const next = BigInt(target.minorUnits) + BigInt(allocation.minorUnits)
      if (next < 0n) throw new Error('Enter an adjustment that leaves every fund nonnegative.')
      target.minorUnits = next.toString()
      allocatedDelta += BigInt(allocation.minorUnits)
    }
    if (allocatedDelta !== delta)
      throw new Error('Enter allocation changes equal to the adjustment amount.')
    const now = new Date().toISOString(),
      state = input.action === 'void' ? 'void' : 'posted',
      after = { netMinor: net.toString(), netAllocations: nextAllocations, state }
    return this.commit({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: site.id,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'gift.adjusted',
      type: 'gift',
      id,
      intent,
      before: { netMinor: row.net_minor, netAllocations: currentAllocations, state: row.state },
      after,
      reason,
      write: this.db
        .prepare(
          "UPDATE vc_crm_gifts SET net_minor=?,net_allocations=?,state=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=? AND state='posted'",
        )
        .bind(
          net.toString(),
          JSON.stringify(nextAllocations),
          state,
          now,
          id,
          site.id,
          input.expectedRevision,
        ),
      dependent: [
        this.db
          .prepare(
            'INSERT INTO vc_crm_gift_adjustments(id,gift_id,action,delta_minor,allocations,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            id,
            input.action,
            input.deltaMinor,
            JSON.stringify(adjustments),
            reason,
            this.actor,
            now,
          ),
      ],
      result: { id, revision: input.expectedRevision + 1 },
    })
  }
}
