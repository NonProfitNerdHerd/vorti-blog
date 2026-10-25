import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { commitCRM, replayCRM } from './mutations'
import { assertMoney } from './money'
import {
  givingDate,
  givingDueOn,
  givingFrequencies,
  recurringPage,
  effectiveGivingCredits,
  type GivingFrequency,
  type GivingPause,
  type GivingInstallment,
} from './commitment-model'

export interface GivingCommitment {
  id: string
  site_id: string
  constituent_id: string
  label: string
  kind: 'pledge' | 'recurring'
  name: string
  currency: string
  exponent: number
  amount_minor: string
  starts_on: string
  ends_on: string | null
  frequency: GivingFrequency
  campaign_id: string | null
  state: 'active' | 'paused' | 'cancelled'
  cancelled_on: string | null
  revision: number
}
interface Application {
  id: string
  commitment_id: string
  installment_key: string
  gift_id: string
  amount_minor: string
  reversed: number
  reason: string
  created_at: string
  effectiveMinor?: string
}
const text = (v: unknown, max: number, required = false): string => {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim()))
    throw new Error('Enter a valid giving value.')
  return v.trim()
}
export function commitmentKind(value: string): 'pledge' | 'recurring' {
  if (value !== 'pledge' && value !== 'recurring')
    throw new Error('Choose pledges or recurring giving.')
  return value
}
function periodCount(start: string, frequency: GivingFrequency, through: string): number {
  if (through < start) return 0
  let lo = 0,
    hi = 500001
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2),
      date = givingDueOn(start, frequency, mid)
    if (date && date <= through) lo = mid + 1
    else hi = mid
  }
  return lo
}
export class CommitmentRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async scope(siteID: string, operation: 'read' | 'edit') {
    const site = await this.authority.require(siteID, 'finances', operation)
    const identity = await this.authority.require(siteID, 'identity', 'read')
    if (identity.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return site
  }
  private async fence(root: string, revision: number) {
    const row = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(root)
      .first<{ authority_revision: number }>()
    if (row?.authority_revision !== revision) throw new SiteAccessError()
  }
  private async row(site: string, id: string): Promise<GivingCommitment> {
    const row = await this.db
      .prepare(
        `SELECT g.*,c.label FROM vc_crm_commitments g JOIN vc_crm_constituents c ON c.id=g.constituent_id AND c.archived=0
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=g.site_id AND a.archived=0 WHERE g.site_id=? AND g.id=?`,
      )
      .bind(site, id)
      .first<GivingCommitment>()
    if (!row) throw new SiteAccessError()
    return row
  }
  async list(siteID: string, kind: 'pledge' | 'recurring', after = '', contact = '') {
    commitmentKind(kind)
    const site = await this.scope(siteID, 'read')
    const rows = await this.db
      .prepare(
        `SELECT g.*,c.label FROM vc_crm_commitments g JOIN vc_crm_constituents c ON c.id=g.constituent_id AND c.archived=0
      JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=g.site_id AND a.archived=0
      WHERE g.site_id=? AND g.kind=? AND g.id>? ${contact ? 'AND g.constituent_id=?' : ''} ORDER BY g.id LIMIT 51`,
      )
      .bind(siteID, kind, after, ...(contact ? [contact] : []))
      .all<GivingCommitment>()
    const canEdit = (await this.authority.authority(siteID, 'finances', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit,
    }
  }
  private async applications(id: string) {
    const all: Application[] = []
    let after = ''
    for (;;) {
      const rows = await this.db
        .prepare(
          'SELECT * FROM vc_crm_giving_applications WHERE commitment_id=? AND id>? ORDER BY id LIMIT 200',
        )
        .bind(id, after)
        .all<Application>()
      all.push(...rows.results)
      if (rows.results.length < 200) break
      after = rows.results.at(-1)!.id
    }
    const gifts = new Set(all.filter((a) => !a.reversed).map((a) => a.gift_id)),
      credits = new Map<string, string>()
    for (const gift of gifts) {
      const ledger = await this.db
        .prepare('SELECT net_minor,state FROM vc_crm_gifts WHERE id=?')
        .bind(gift)
        .first<{ net_minor: string; state: string }>()
      if (!ledger) throw new SiteAccessError()
      const allocations: Array<{ id: string; minorUnits: string }> = []
      let cursor = ''
      for (;;) {
        const page = await this.db
          .prepare(
            'SELECT id,amount_minor FROM vc_crm_giving_applications WHERE gift_id=? AND reversed=0 AND id>? ORDER BY id LIMIT 200',
          )
          .bind(gift, cursor)
          .all<{ id: string; amount_minor: string }>()
        allocations.push(...page.results.map((a) => ({ id: a.id, minorUnits: a.amount_minor })))
        if (page.results.length < 200) break
        cursor = page.results.at(-1)!.id
      }
      for (const [key, value] of effectiveGivingCredits(
        ledger.state === 'void' ? '0' : ledger.net_minor,
        allocations,
      ))
        credits.set(key, value)
    }
    return all.map((a) => ({ ...a, effectiveMinor: a.reversed ? '0' : credits.get(a.id) || '0' }))
  }
  private async periods(row: GivingCommitment, after = 0) {
    const pauses = (
      await this.db
        .prepare(
          'SELECT started_on,resumed_on FROM vc_crm_giving_pauses WHERE commitment_id=? ORDER BY started_on,id',
        )
        .bind(row.id)
        .all<GivingPause>()
    ).results
    const installments =
      row.kind === 'pledge'
        ? (
            await this.db
              .prepare(
                'SELECT id AS key,due_on AS dueOn,amount_minor AS minorUnits FROM vc_crm_pledge_installments WHERE commitment_id=? ORDER BY due_on,id',
              )
              .bind(row.id)
              .all<GivingInstallment>()
          ).results
        : []
    const end =
      row.cancelled_on && (!row.ends_on || row.cancelled_on < row.ends_on)
        ? row.cancelled_on
        : row.ends_on
    const page =
      row.kind === 'pledge'
        ? {
            docs: installments.slice(after, after + 24).map((i) => ({ ...i, skipped: false })),
            next: after + 24 < installments.length ? after + 24 : null,
          }
        : recurringPage({
            start: row.starts_on,
            end,
            frequency: row.frequency,
            minorUnits: row.amount_minor,
            pauses,
            after,
          })
    return { pauses, installments, ...page }
  }
  async history(siteID: string, id: string, after?: { createdAt: string; id: string }) {
    if (
      after &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(after.createdAt) ||
        !after.id ||
        after.id.length > 128)
    )
      throw new Error('Choose a valid giving history page.')
    const site = await this.scope(siteID, 'read')
    await this.row(siteID, id)
    const rows = (
      await this.db
        .prepare(
          `
      SELECT a.id,a.created_at AS createdAt,a.action,a.reason,
        COALESCE(u.attribution_label,'Account #'||a.actor_id) AS actorLabel,
        CASE WHEN a.action='giving.changed' THEN json_extract(a.after_value,'$.action') ELSE NULL END AS change,
        CASE WHEN a.action='giving.changed' THEN json_extract(a.after_value,'$.effectiveOn') ELSE NULL END AS effectiveOn,
        CASE WHEN a.action='giving.changed' THEN json_extract(a.after_value,'$.name') ELSE NULL END AS name
      FROM vc_platform_audit a LEFT JOIN users u ON u.id=a.actor_id
      WHERE a.organization_id=? AND a.site_id=? AND a.record_type='giving' AND a.record_id=?
        AND a.action IN('giving.created','giving.changed','giving.payment-applied','giving.payment-reversed')
        ${after ? 'AND (a.created_at<? OR (a.created_at=? AND a.id<?))' : ''}
      ORDER BY a.created_at DESC,a.id DESC LIMIT 26
    `,
        )
        .bind(
          site.organization_id,
          siteID,
          id,
          ...(after ? [after.createdAt, after.createdAt, after.id] : []),
        )
        .all<{
          id: string
          createdAt: string
          action: string
          reason: string | null
          actorLabel: string
          change: string | null
          effectiveOn: string | null
          name: string | null
        }>()
    ).results
    await this.row(siteID, id)
    await this.fence(site.organization_id, site.authorityRevision)
    const docs = rows.slice(0, 25)
    const last = docs[docs.length - 1]
    return { docs, next: rows.length > 25 ? { createdAt: last.createdAt, id: last.id } : null }
  }
  async get(siteID: string, id: string, through: string, after = 0) {
    givingDate(through)
    if (!Number.isSafeInteger(after) || after < 0 || after > 500000)
      throw new Error('Choose a valid giving page.')
    const site = await this.scope(siteID, 'read'),
      doc = await this.row(siteID, id)
    const periods = await this.periods(doc, after),
      apps = await this.applications(id)
    const credited = new Map<string, bigint>()
    for (const a of apps)
      credited.set(
        a.installment_key,
        (credited.get(a.installment_key) || 0n) + BigInt(a.effectiveMinor),
      )
    const received = [...credited.values()].reduce((sum, n) => sum + n, 0n)
    let expected = 0n,
      due = 0n
    if (doc.kind === 'pledge') {
      expected = BigInt(doc.amount_minor)
      for (const i of periods.installments)
        if (i.dueOn <= through) {
          const balance = BigInt(i.minorUnits) - (credited.get(i.key) || 0n)
          if (balance > 0n) due += balance
        }
    } else {
      const cutoff = [through, doc.ends_on, doc.cancelled_on]
        .filter((d): d is string => !!d)
        .sort()[0]
      const baseCount = periodCount(doc.starts_on, doc.frequency, cutoff)
      let count = baseCount
      for (const pause of periods.pauses) {
        const beforePause =
          periodCount(doc.starts_on, doc.frequency, pause.started_on) -
          (givingDueOn(
            doc.starts_on,
            doc.frequency,
            periodCount(doc.starts_on, doc.frequency, pause.started_on) - 1,
          ) === pause.started_on
            ? 1
            : 0)
        const beforeResume = pause.resumed_on
          ? periodCount(doc.starts_on, doc.frequency, pause.resumed_on) -
            (givingDueOn(
              doc.starts_on,
              doc.frequency,
              periodCount(doc.starts_on, doc.frequency, pause.resumed_on) - 1,
            ) === pause.resumed_on
              ? 1
              : 0)
          : baseCount
        count -= Math.max(0, Math.min(baseCount, beforeResume) - Math.min(baseCount, beforePause))
      }
      expected = BigInt(count) * BigInt(doc.amount_minor)
      due = expected
      for (const [key, credit] of credited) {
        const ordinal = Number(key),
          date = givingDueOn(doc.starts_on, doc.frequency, ordinal)
        if (
          date &&
          date <= cutoff &&
          !periods.pauses.some(
            (p) => date >= p.started_on && (!p.resumed_on || date < p.resumed_on),
          )
        )
          due -= credit > BigInt(doc.amount_minor) ? BigInt(doc.amount_minor) : credit
      }
    }
    const outstanding =
      doc.kind === 'pledge'
        ? BigInt(doc.amount_minor) > received
          ? BigInt(doc.amount_minor) - received
          : 0n
        : due
    const canEdit = (await this.authority.authority(siteID, 'finances', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      doc,
      pauses: periods.pauses,
      installments: periods.docs.map((i) => ({
        ...i,
        receivedMinor: (credited.get(i.key) || 0n).toString(),
      })),
      next: periods.next,
      applications: apps,
      summary: {
        through,
        expectedMinor: expected.toString(),
        receivedMinor: received.toString(),
        overdueMinor: doc.state === 'cancelled' && doc.kind === 'pledge' ? '0' : due.toString(),
        outstandingMinor:
          doc.state === 'cancelled' && doc.kind === 'pledge' ? '0' : outstanding.toString(),
        cancelledMinor:
          doc.state === 'cancelled' && doc.kind === 'pledge' ? outstanding.toString() : '0',
      },
      canEdit,
    }
  }
  async create(input: { site: string; operationKey: string; values: Record<string, unknown> }) {
    const site = await this.scope(input.site, 'edit'),
      v = input.values,
      kind = commitmentKind(String(v.kind)),
      name = text(v.name, 180, true)
    const constituent = text(v.constituent, 100, true),
      currency = text(v.currency, 3, true),
      amount = text(v.minorUnits, 31, true),
      exponent = Number(v.exponent)
    assertMoney({ currency, minorUnits: amount })
    if (
      BigInt(amount) <= 0n ||
      !Number.isInteger(exponent) ||
      exponent < 0 ||
      exponent > 4 ||
      !givingFrequencies.includes(v.frequency as GivingFrequency)
    )
      throw new Error('Enter a positive giving amount and valid currency precision/frequency.')
    const start = givingDate(v.startsOn),
      end = v.endsOn ? givingDate(v.endsOn) : null,
      frequency = v.frequency as GivingFrequency
    if (end && end < start) throw new Error('Choose an end date on or after the start date.')
    const campaign = v.campaign ? text(v.campaign, 100, true) : null
    const installments: GivingInstallment[] = []
    if (kind === 'pledge') {
      if (!Array.isArray(v.installments) || !v.installments.length || v.installments.length > 120)
        throw new Error('Choose one to 120 pledge installments.')
      for (const i of v.installments as Array<Record<string, unknown>>) {
        if (!i || typeof i !== 'object') throw new Error('Enter a valid pledge installment.')
        const dueOn = givingDate(i.dueOn),
          minorUnits = text(i.minorUnits, 31, true)
        assertMoney({ currency, minorUnits })
        if (dueOn < start || (end && dueOn > end) || BigInt(minorUnits) <= 0n)
          throw new Error('Enter positive installments within the pledge dates.')
        installments.push({ key: crypto.randomUUID(), dueOn, minorUnits })
      }
      if (installments.reduce((sum, i) => sum + BigInt(i.minorUnits), 0n) !== BigInt(amount))
        throw new Error('Pledge installments must equal the total pledge amount.')
    }
    const intent = {
      ...v,
      installments: installments.map((i) => ({ dueOn: i.dueOn, minorUnits: i.minorUnits })),
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'giving.created',
      type: 'giving',
      intent,
    })
    if (replay) return replay
    const id = crypto.randomUUID(),
      now = new Date().toISOString()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'giving.created',
      type: 'giving',
      id,
      after: intent,
      intent,
      write: this.db
        .prepare(
          'INSERT INTO vc_crm_commitments(id,site_id,constituent_id,kind,name,currency,exponent,amount_minor,starts_on,ends_on,frequency,campaign_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          input.site,
          constituent,
          kind,
          name,
          currency,
          exponent,
          amount,
          start,
          end,
          frequency,
          campaign,
          this.actor,
          now,
          now,
        ),
      dependent: installments.map((i) =>
        this.db
          .prepare(
            'INSERT INTO vc_crm_pledge_installments(id,commitment_id,due_on,amount_minor) VALUES(?,?,?,?)',
          )
          .bind(i.key, id, i.dueOn, i.minorUnits),
      ),
      result: { id },
    })
  }
  async change(input: {
    site: string
    id: string
    expectedRevision: number
    operationKey: string
    action: 'pause' | 'resume' | 'cancel' | 'rename'
    effectiveOn: string
    reason: string
    name?: string
  }) {
    const site = await this.scope(input.site, 'edit'),
      row = await this.row(input.site, input.id),
      date = givingDate(input.effectiveOn),
      reason = text(input.reason, 2000, true)
    const intent = {
      id: input.id,
      expectedRevision: input.expectedRevision,
      action: input.action,
      effectiveOn: date,
      reason,
      name: input.name ?? null,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action: 'giving.changed',
      type: 'giving',
      intent,
    })
    if (replay) return replay
    if (row.revision !== input.expectedRevision || !Number.isSafeInteger(input.expectedRevision))
      throw new SiteConflictError()
    if (row.state === 'cancelled' || date < row.starts_on)
      throw new Error('Choose an active giving schedule and a date on or after its start.')
    const dependent: D1PreparedStatement[] = [],
      now = new Date().toISOString()
    let state: GivingCommitment['state'] = row.state
    let name = row.name,
      cancelled = row.cancelled_on
    if (input.action === 'pause') {
      if (row.kind !== 'recurring' || row.state !== 'active')
        throw new Error('Choose an active recurring schedule to pause.')
      const latest = await this.db
        .prepare(
          'SELECT resumed_on FROM vc_crm_giving_pauses WHERE commitment_id=? ORDER BY started_on DESC LIMIT 1',
        )
        .bind(row.id)
        .first<{ resumed_on: string | null }>()
      if (latest && (!latest.resumed_on || date < latest.resumed_on))
        throw new Error('Choose a pause date after the previous pause.')
      const applications = await this.applications(row.id)
      if (
        applications.some(
          (a) =>
            !a.reversed &&
            givingDueOn(row.starts_on, row.frequency, Number(a.installment_key))! >= date,
        )
      )
        throw new Error('Remove future payment applications before pausing those periods.')
      state = 'paused'
      dependent.push(
        this.db
          .prepare('INSERT INTO vc_crm_giving_pauses(id,commitment_id,started_on) VALUES(?,?,?)')
          .bind(crypto.randomUUID(), row.id, date),
      )
    } else if (input.action === 'resume') {
      if (row.state !== 'paused') throw new Error('Choose a paused recurring schedule to resume.')
      const pause = await this.db
        .prepare(
          'SELECT id,started_on FROM vc_crm_giving_pauses WHERE commitment_id=? AND resumed_on IS NULL',
        )
        .bind(row.id)
        .first<{ id: string; started_on: string }>()
      if (!pause || date < pause.started_on)
        throw new Error('Choose a resume date on or after the pause date.')
      state = 'active'
      dependent.push(
        this.db
          .prepare('UPDATE vc_crm_giving_pauses SET resumed_on=? WHERE id=?')
          .bind(date, pause.id),
      )
    } else if (input.action === 'cancel') {
      if (
        row.kind === 'recurring' &&
        (await this.applications(row.id)).some(
          (a) =>
            !a.reversed &&
            givingDueOn(row.starts_on, row.frequency, Number(a.installment_key))! > date,
        )
      )
        throw new Error('Remove payment applications after the cancellation date first.')
      state = 'cancelled'
      cancelled = date
    } else if (input.action === 'rename') name = text(input.name, 180, true)
    else throw new Error('Choose a supported giving change.')
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action: 'giving.changed',
      type: 'giving',
      id: row.id,
      before: row,
      after: { ...intent, state, name },
      reason,
      intent,
      write: this.db
        .prepare(
          'UPDATE vc_crm_commitments SET name=?,state=?,cancelled_on=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
        )
        .bind(name, state, cancelled, now, row.id, input.site, input.expectedRevision),
      dependent,
      result: { id: row.id },
    })
  }
  async apply(input: {
    site: string
    id: string
    expectedRevision: number
    operationKey: string
    gift: string
    giftRevision: number
    installment: string
    minorUnits: string
    reason: string
    reverseApplication?: string
  }) {
    const site = await this.scope(input.site, 'edit'),
      row = await this.row(input.site, input.id),
      reason = text(input.reason, 2000, true)
    const intent: Omit<typeof input, 'operationKey'> = {
      site: input.site,
      id: input.id,
      expectedRevision: input.expectedRevision,
      gift: input.gift,
      giftRevision: input.giftRevision,
      installment: input.installment,
      minorUnits: input.minorUnits,
      reason: input.reason,
      reverseApplication: input.reverseApplication,
    }
    const action = input.reverseApplication ? 'giving.payment-reversed' : 'giving.payment-applied'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'giving',
      intent,
    })
    if (replay) return replay
    if (
      row.revision !== input.expectedRevision ||
      !Number.isSafeInteger(input.expectedRevision) ||
      !Number.isSafeInteger(input.giftRevision)
    )
      throw new SiteConflictError()
    const gift = await this.db
      .prepare('SELECT * FROM vc_crm_gifts WHERE id=? AND site_id=? AND constituent_id=?')
      .bind(input.gift, input.site, row.constituent_id)
      .first<{
        revision: number
        net_minor: string
        state: string
        kind: string
        currency: string
        exponent: number
      }>()
    if (!gift) throw new SiteAccessError()
    if (gift.revision !== input.giftRevision) throw new SiteConflictError()
    const dependent: D1PreparedStatement[] = [],
      id = crypto.randomUUID(),
      now = new Date().toISOString()
    if (input.reverseApplication) {
      const app = await this.db
        .prepare(
          'SELECT id FROM vc_crm_giving_applications WHERE id=? AND commitment_id=? AND gift_id=? AND reversed=0',
        )
        .bind(input.reverseApplication, row.id, input.gift)
        .first()
      if (!app) throw new SiteConflictError()
      dependent.push(
        this.db
          .prepare('UPDATE vc_crm_giving_applications SET reversed=1,reversed_at=? WHERE id=?')
          .bind(now, input.reverseApplication),
      )
    } else {
      assertMoney({ currency: row.currency, minorUnits: input.minorUnits })
      if (
        row.state === 'cancelled' ||
        gift.kind === 'in-kind' ||
        gift.state !== 'posted' ||
        gift.currency !== row.currency ||
        gift.exponent !== row.exponent ||
        BigInt(input.minorUnits) <= 0n
      )
        throw new Error('Choose an available matching cash gift and positive payment amount.')
      if (row.kind === 'pledge') {
        const installment = await this.db
          .prepare('SELECT id FROM vc_crm_pledge_installments WHERE commitment_id=? AND id=?')
          .bind(row.id, input.installment)
          .first()
        if (!installment) throw new SiteAccessError()
      } else {
        if (!/^(0|[1-9][0-9]*)$/.test(input.installment))
          throw new Error('Choose a valid recurring period.')
        const page = await this.periods(row, Number(input.installment)),
          period = page.docs[0]
        if (!period || period.key !== input.installment || period.skipped)
          throw new Error('Choose an expected recurring period that is not paused or cancelled.')
      }
      let allocated = 0n,
        after = ''
      for (;;) {
        const apps = await this.db
          .prepare(
            'SELECT id,amount_minor FROM vc_crm_giving_applications WHERE gift_id=? AND reversed=0 AND id>? ORDER BY id LIMIT 200',
          )
          .bind(input.gift, after)
          .all<{ id: string; amount_minor: string }>()
        for (const a of apps.results) allocated += BigInt(a.amount_minor)
        if (apps.results.length < 200) break
        after = apps.results.at(-1)!.id
      }
      if (allocated + BigInt(input.minorUnits) > BigInt(gift.net_minor))
        throw new Error(
          'Payment applications cannot exceed the gift’s current net amount. Review existing applications after refunds.',
        )
      dependent.push(
        this.db
          .prepare(
            'INSERT INTO vc_crm_giving_applications(id,commitment_id,installment_key,gift_id,amount_minor,reason,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(id, row.id, input.installment, input.gift, input.minorUnits, reason, now),
      )
    }
    // Gift revision serializes applications across different pledges with refunds/corrections.
    dependent.unshift(
      this.db
        .prepare(
          'UPDATE vc_crm_gifts SET revision=revision+1,updated_at=? WHERE id=? AND revision=?',
        )
        .bind(now, input.gift, input.giftRevision),
      this.db
        .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
        .bind(`${input.operationKey}:gift`),
      this.db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(`${input.operationKey}:gift`),
    )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'giving',
      id: row.id,
      after: intent,
      reason,
      intent,
      write: this.db
        .prepare(
          'UPDATE vc_crm_commitments SET revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
        )
        .bind(now, row.id, input.site, input.expectedRevision),
      dependent,
      result: { id: row.id },
    })
  }
}
