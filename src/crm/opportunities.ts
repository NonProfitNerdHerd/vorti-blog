import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { commitCRM, replayCRM } from './mutations'
import { assertMoney } from './money'
import { givingDate } from './commitment-model'
import {
  defaultOpportunityStages,
  opportunityOutcomes,
  type Opportunity,
  type OpportunityPipeline,
  type OpportunityStage,
} from './opportunity-model'

const text = (v: unknown, max: number, required = false) => {
  if (
    typeof v !== 'string' ||
    v.trim().length > max ||
    (required && !v.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    throw new Error('Enter valid opportunity values within the length limits.')
  return v.trim()
}
type Mutation = {
  site: string
  id?: string
  expectedRevision?: number
  operationKey: string
  values: Record<string, unknown>
}
const contactJoin = `JOIN vc_crm_constituents c ON c.id=o.constituent_id AND c.archived=0 JOIN vc_crm_affiliations a ON a.constituent_id=c.id AND a.site_id=o.site_id AND a.archived=0`
export class OpportunityRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async scope(site: string, operation: 'read' | 'edit' | 'configure') {
    const access = await this.authority.require(site, 'restricted-activity', operation)
    const identity = await this.authority.require(site, 'identity', 'read')
    if (access.authorityRevision !== identity.authorityRevision) throw new SiteAccessError()
    return access
  }
  private async fence(root: string, revision: number) {
    const row = await this.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(root)
      .first<{ authority_revision: number }>()
    if (row?.authority_revision !== revision) throw new SiteAccessError()
  }
  private async row(site: string, id: string) {
    const row = await this.db
      .prepare(
        `SELECT o.*,c.label FROM vc_crm_opportunities o ${contactJoin} WHERE o.site_id=? AND o.id=?`,
      )
      .bind(site, id)
      .first<Opportunity>()
    if (!row) throw new SiteAccessError()
    return row
  }
  async pipelines(siteID: string, after = '') {
    const site = await this.scope(siteID, 'read')
    const rows = await this.db
      .prepare(
        'SELECT * FROM vc_crm_opportunity_pipelines WHERE site_id=? AND id>? ORDER BY id LIMIT 51',
      )
      .bind(siteID, after)
      .all<OpportunityPipeline>()
    const canConfigure = (
      await this.authority.authority(siteID, 'restricted-activity', 'configure')
    ).allowed
    const canEdit = (await this.authority.authority(siteID, 'restricted-activity', 'edit')).allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canConfigure,
      canEdit,
    }
  }
  async stages(siteID: string, pipeline: string) {
    const site = await this.scope(siteID, 'read')
    if (
      !(await this.db
        .prepare('SELECT id FROM vc_crm_opportunity_pipelines WHERE site_id=? AND id=?')
        .bind(siteID, pipeline)
        .first())
    )
      throw new SiteAccessError()
    const docs = (
      await this.db
        .prepare('SELECT * FROM vc_crm_opportunity_stages WHERE pipeline_id=? ORDER BY position,id')
        .bind(pipeline)
        .all<OpportunityStage>()
    ).results
    await this.fence(site.organization_id, site.authorityRevision)
    return { docs }
  }
  async owners(siteID: string, after = 0) {
    const site = await this.scope(siteID, 'read')
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid page cursor.')
    const candidates = await this.db
      .prepare(
        `SELECT u.id,u.attribution_label FROM users u WHERE u.id>? AND (EXISTS(SELECT 1 FROM vc_installation_operators p WHERE p.user_id=u.id) OR EXISTS(SELECT 1 FROM vc_site_memberships m JOIN vc_sites s ON s.id=m.site_id WHERE m.user_id=u.id AND m.active=1 AND s.organization_id=?)) ORDER BY u.id LIMIT 26`,
      )
      .bind(after, site.organization_id)
      .all<{ id: number; attribution_label: string | null }>()
    const docs: Array<{ id: number; label: string }> = []
    for (const user of candidates.results.slice(0, 25)) {
      const policy = new OrganizationRepository(this.db, user.id)
      if (
        (await policy.authority(siteID, 'restricted-activity', 'edit')).allowed &&
        (await policy.authority(siteID, 'identity', 'read')).allowed
      )
        docs.push({ id: user.id, label: user.attribution_label || `Staff #${user.id}` })
    }
    await this.fence(site.organization_id, site.authorityRevision)
    return { docs, next: candidates.results.length > 25 ? candidates.results[24].id : null }
  }
  async savePipeline(input: Mutation) {
    const site = await this.scope(input.site, 'configure'),
      name = text(input.values.name, 120, true),
      archived = input.values.archived === true ? 1 : 0
    const action = input.id ? 'opportunity.pipeline.updated' : 'opportunity.pipeline.created',
      intent = { id: input.id || null, revision: input.expectedRevision ?? null, name, archived }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'opportunity-pipeline',
      intent,
    })
    if (replay) return replay
    const id = input.id || crypto.randomUUID()
    const before = input.id
      ? await this.db
          .prepare('SELECT * FROM vc_crm_opportunity_pipelines WHERE site_id=? AND id=?')
          .bind(input.site, id)
          .first<OpportunityPipeline>()
      : null
    if (input.id && !before) throw new SiteAccessError()
    if (input.id && !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'opportunity-pipeline',
      id,
      before,
      after: intent,
      intent,
      write: input.id
        ? this.db
            .prepare(
              'UPDATE vc_crm_opportunity_pipelines SET name=?,archived=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=?',
            )
            .bind(name, archived, id, input.site, input.expectedRevision!)
        : this.db
            .prepare(
              'INSERT INTO vc_crm_opportunity_pipelines(id,site_id,name,archived) VALUES(?,?,?,?)',
            )
            .bind(id, input.site, name, archived),
      dependent: input.id
        ? []
        : defaultOpportunityStages.map((stage, index) =>
            this.db
              .prepare(
                'INSERT INTO vc_crm_opportunity_stages(id,pipeline_id,name,position,outcome) VALUES(?,?,?,?,?)',
              )
              .bind(crypto.randomUUID(), id, stage.name, index, stage.outcome),
          ),
      result: { id },
    })
  }
  async saveStage(input: Mutation) {
    const site = await this.scope(input.site, 'configure'),
      v = input.values,
      pipeline = text(v.pipeline, 100, true),
      name = text(v.name, 120, true),
      outcome = String(v.outcome),
      position = Number(v.position),
      archived = v.archived === true ? 1 : 0
    if (
      !opportunityOutcomes.includes(outcome as (typeof opportunityOutcomes)[number]) ||
      !Number.isSafeInteger(position) ||
      position < 0 ||
      position > 9999
    )
      throw new Error('Choose a valid stage outcome and order.')
    const action = input.id ? 'opportunity.stage.updated' : 'opportunity.stage.created',
      intent = {
        id: input.id || null,
        revision: input.expectedRevision ?? null,
        pipeline,
        name,
        outcome,
        position,
        archived,
      }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'opportunity-stage',
      intent,
    })
    if (replay) return replay
    if (
      !(await this.db
        .prepare(
          'SELECT id FROM vc_crm_opportunity_pipelines WHERE site_id=? AND id=? AND archived=0',
        )
        .bind(input.site, pipeline)
        .first())
    )
      throw new SiteAccessError()
    const id = input.id || crypto.randomUUID(),
      before = input.id
        ? await this.db
            .prepare('SELECT * FROM vc_crm_opportunity_stages WHERE id=? AND pipeline_id=?')
            .bind(id, pipeline)
            .first<OpportunityStage>()
        : null
    if (input.id && !before) throw new SiteAccessError()
    if (input.id && !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'opportunity-stage',
      id,
      before,
      after: intent,
      intent,
      write: input.id
        ? this.db
            .prepare(
              'UPDATE vc_crm_opportunity_stages SET name=?,position=?,outcome=?,archived=?,revision=revision+1 WHERE id=? AND pipeline_id=? AND revision=?',
            )
            .bind(name, position, outcome, archived, id, pipeline, input.expectedRevision!)
        : this.db
            .prepare(
              'INSERT INTO vc_crm_opportunity_stages(id,pipeline_id,name,position,outcome,archived) VALUES(?,?,?,?,?,?)',
            )
            .bind(id, pipeline, name, position, outcome, archived),
      dependent: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_opportunity_pipelines WHERE id=? AND site_id=? AND archived=0',
          )
          .bind(`${input.operationKey}:pipeline`, pipeline, input.site),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:pipeline`),
      ],
      result: { id },
    })
  }
  async list(input: {
    site: string
    pipeline?: string
    stage?: string
    contact?: string
    after?: string
    dueThrough?: string
    owner?: number
    archived?: boolean
  }) {
    const site = await this.scope(input.site, 'read'),
      clauses = ['o.site_id=?', 'o.archived=?'],
      params: Array<string | number> = [input.site, input.archived ? 1 : 0]
    for (const [column, value] of [
      ['pipeline_id', input.pipeline],
      ['stage_id', input.stage],
      ['constituent_id', input.contact],
    ] as const)
      if (value) {
        clauses.push(`o.${column}=?`)
        params.push(value)
      }
    if (input.owner !== undefined) {
      if (!Number.isSafeInteger(input.owner) || input.owner <= 0)
        throw new Error('Choose an owner.')
      clauses.push('o.owner_id=?')
      params.push(input.owner)
    }
    if (input.dueThrough) {
      clauses.push('o.next_on<=?')
      params.push(givingDate(input.dueThrough))
    }
    const where = clauses.join(' AND ')
    const rows = await this.db
      .prepare(
        `SELECT o.*,c.label FROM vc_crm_opportunities o ${contactJoin} WHERE ${where} AND o.id>? ORDER BY o.id LIMIT 51`,
      )
      .bind(...params, input.after || '')
      .all<Opportunity>()
    const count = await this.db
      .prepare(`SELECT count(*) AS n FROM vc_crm_opportunities o ${contactJoin} WHERE ${where}`)
      .bind(...params)
      .first<{ n: number }>()
    const canEdit = (await this.authority.authority(input.site, 'restricted-activity', 'edit'))
      .allowed
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      total: count!.n,
      canEdit,
    }
  }
  async get(siteID: string, id: string, historyAfter = '', linkAfter = '') {
    const site = await this.scope(siteID, 'read'),
      doc = await this.row(siteID, id)
    const history = await this.db
      .prepare(
        "SELECT *,created_at||'|'||id AS cursor FROM vc_crm_opportunity_stage_history WHERE opportunity_id=? AND created_at||'|'||id>? ORDER BY created_at,id LIMIT 51",
      )
      .bind(id, historyAfter)
      .all<{
        id: string
        from_label: string | null
        to_label: string
        reason: string
        created_at: string
        cursor: string
      }>()
    const canFinance = (await this.authority.authority(siteID, 'finances', 'read')).allowed,
      canEdit = (await this.authority.authority(siteID, 'restricted-activity', 'edit')).allowed
    const links = canFinance
      ? await this.db
          .prepare(
            'SELECT * FROM vc_crm_opportunity_links WHERE opportunity_id=? AND id>? ORDER BY id LIMIT 51',
          )
          .bind(id, linkAfter)
          .all<{
            id: string
            gift_id: string | null
            commitment_id: string | null
            removed: number
            created_at: string
            reason: string
          }>()
      : { results: [] as never[] }
    await this.fence(site.organization_id, site.authorityRevision)
    return {
      doc,
      history: history.results.slice(0, 50),
      historyNext: history.results.length > 50 ? history.results[49].cursor : null,
      links: links.results.slice(0, 50),
      linkNext: links.results.length > 50 ? links.results[49].id : null,
      canEdit,
      canFinance,
    }
  }
  async save(input: Mutation) {
    const site = await this.scope(input.site, 'edit'),
      v = input.values,
      before = input.id ? await this.row(input.site, input.id) : null
    const constituent = before?.constituent_id || text(v.constituent, 100, true),
      name = text(v.name, 180, true),
      pipeline = text(v.pipeline, 100, true),
      stage = text(v.stage, 100, true),
      notes = text(v.notes ?? '', 16000),
      nextAction = text(v.nextAction ?? '', 1000),
      target = v.targetOn ? givingDate(v.targetOn) : null,
      nextOn = v.nextOn ? givingDate(v.nextOn) : null
    const owner = v.owner == null || v.owner === '' ? null : Number(v.owner),
      amount = v.minorUnits == null || v.minorUnits === '' ? null : text(v.minorUnits, 31, true),
      currency = text(v.currency, 3, true),
      exponent = Number(v.exponent),
      campaign = v.campaign ? text(v.campaign, 100, true) : null,
      archived = v.archived === true ? 1 : 0
    assertMoney({ currency, minorUnits: amount ?? '0' })
    if (
      (amount !== null && BigInt(amount) < 0n) ||
      !Number.isInteger(exponent) ||
      exponent < 0 ||
      exponent > 4 ||
      (owner !== null && (!Number.isSafeInteger(owner) || owner <= 0))
    )
      throw new Error('Enter a valid estimate, precision and owner.')
    const reason = text(v.reason ?? '', 2000),
      intent = {
        id: input.id || null,
        revision: input.expectedRevision ?? null,
        constituent,
        name,
        pipeline,
        stage,
        notes,
        nextAction,
        target,
        nextOn,
        owner,
        amount,
        currency,
        exponent,
        campaign,
        archived,
        reason,
      },
      action = before ? 'opportunity.updated' : 'opportunity.created'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'opportunity',
      intent,
    })
    if (replay) return replay
    if (before && !Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const chosen = await this.db
      .prepare(
        'SELECT s.*,p.archived AS pipeline_archived,p.revision AS pipeline_revision FROM vc_crm_opportunity_stages s JOIN vc_crm_opportunity_pipelines p ON p.id=s.pipeline_id WHERE s.id=? AND s.pipeline_id=? AND p.site_id=?',
      )
      .bind(stage, pipeline, input.site)
      .first<OpportunityStage & { pipeline_archived: number; pipeline_revision: number }>()
    if (!chosen || ((chosen.archived || chosen.pipeline_archived) && stage !== before?.stage_id))
      throw new Error('Choose an active stage and pipeline.')
    if (before && stage !== before.stage_id && !reason)
      throw new Error('Enter a reason for the stage change.')
    if (owner !== null && owner !== before?.owner_id) {
      const ownerScope = await new OrganizationRepository(this.db, owner).require(
        input.site,
        'restricted-activity',
        'edit',
      )
      if (ownerScope.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
      await new OrganizationRepository(this.db, owner).require(input.site, 'identity', 'read')
    }
    if (
      campaign &&
      campaign !== before?.campaign_id &&
      !(await this.db
        .prepare('SELECT id FROM vc_crm_campaigns WHERE id=? AND site_id=? AND archived=0')
        .bind(campaign, input.site)
        .first())
    )
      throw new SiteAccessError()
    const id = input.id || crypto.randomUUID(),
      now = new Date().toISOString(),
      dependent: D1PreparedStatement[] = []
    dependent.push(
      this.db
        .prepare(
          'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_opportunity_stages s JOIN vc_crm_opportunity_pipelines p ON p.id=s.pipeline_id WHERE s.id=? AND s.revision=? AND p.revision=?',
        )
        .bind(`${input.operationKey}:stage`, stage, chosen.revision, chosen.pipeline_revision),
      this.db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(`${input.operationKey}:stage`),
    )
    if (campaign && campaign !== before?.campaign_id)
      dependent.push(
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_crm_campaigns WHERE id=? AND site_id=? AND archived=0',
          )
          .bind(`${input.operationKey}:campaign`, campaign, input.site),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(`${input.operationKey}:campaign`),
      )
    if (!before || before.stage_id !== stage) {
      const old = before
        ? await this.db
            .prepare('SELECT name FROM vc_crm_opportunity_stages WHERE id=?')
            .bind(before.stage_id)
            .first<{ name: string }>()
        : null
      dependent.push(
        this.db
          .prepare(
            'INSERT INTO vc_crm_opportunity_stage_history(id,opportunity_id,from_stage,to_stage,from_label,to_label,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            id,
            before?.stage_id || null,
            stage,
            old?.name || null,
            chosen.name,
            this.actor,
            reason || 'Opportunity created',
            now,
          ),
      )
    }
    const values = [
      name,
      pipeline,
      stage,
      owner,
      amount,
      currency,
      exponent,
      campaign,
      target,
      nextAction,
      nextOn,
      notes,
      archived,
      now,
    ]
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'opportunity',
      id,
      before,
      after: intent,
      intent,
      reason,
      write: before
        ? this.db
            .prepare(
              'UPDATE vc_crm_opportunities SET name=?,pipeline_id=?,stage_id=?,owner_id=?,expected_minor=?,currency=?,exponent=?,campaign_id=?,target_on=?,next_action=?,next_on=?,notes=?,archived=?,updated_at=?,revision=revision+1 WHERE id=? AND site_id=? AND revision=?',
            )
            .bind(...values, id, input.site, input.expectedRevision!)
        : this.db
            .prepare(
              'INSERT INTO vc_crm_opportunities(name,pipeline_id,stage_id,owner_id,expected_minor,currency,exponent,campaign_id,target_on,next_action,next_on,notes,archived,updated_at,id,site_id,constituent_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(...values, id, input.site, constituent, this.actor, now),
      dependent,
      result: { id },
    })
  }
  async link(input: {
    site: string
    id: string
    expectedRevision: number
    operationKey: string
    gift?: string
    pledge?: string
    remove?: string
    reason: string
  }) {
    const site = await this.scope(input.site, 'edit')
    await this.authority.require(input.site, 'finances', 'read')
    const doc = await this.row(input.site, input.id),
      reason = text(input.reason, 2000, true),
      action = input.remove ? 'opportunity.link.removed' : 'opportunity.link.created',
      intent = {
        id: input.id,
        revision: input.expectedRevision,
        gift: input.gift || null,
        pledge: input.pledge || null,
        remove: input.remove || null,
        reason,
      }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'opportunity',
      intent,
    })
    if (replay) return replay
    if (!Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
    const now = new Date().toISOString(),
      dependent: D1PreparedStatement[] = []
    if (input.remove) {
      if (
        !(await this.db
          .prepare(
            'SELECT id FROM vc_crm_opportunity_links WHERE id=? AND opportunity_id=? AND removed=0',
          )
          .bind(input.remove, input.id)
          .first())
      )
        throw new SiteAccessError()
      dependent.push(
        this.db
          .prepare(
            'UPDATE vc_crm_opportunity_links SET removed=1,removed_at=? WHERE id=? AND opportunity_id=? AND removed=0',
          )
          .bind(now, input.remove, input.id),
      )
    } else {
      if (Boolean(input.gift) === Boolean(input.pledge))
        throw new Error('Choose exactly one received gift or pledge.')
      if (
        input.gift &&
        !(await this.db
          .prepare(
            "SELECT id FROM vc_crm_gifts WHERE id=? AND site_id=? AND constituent_id=? AND state='posted'",
          )
          .bind(input.gift, input.site, doc.constituent_id)
          .first())
      )
        throw new SiteAccessError()
      if (
        input.pledge &&
        !(await this.db
          .prepare(
            "SELECT id FROM vc_crm_commitments WHERE id=? AND site_id=? AND constituent_id=? AND kind='pledge'",
          )
          .bind(input.pledge, input.site, doc.constituent_id)
          .first())
      )
        throw new SiteAccessError()
      dependent.push(
        this.db
          .prepare(
            'INSERT INTO vc_crm_opportunity_links(id,opportunity_id,gift_id,commitment_id,created_by,created_at,reason) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            input.id,
            input.gift || null,
            input.pledge || null,
            this.actor,
            now,
            reason,
          ),
      )
    }
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'opportunity',
      id: input.id,
      before: null,
      after: intent,
      intent,
      reason,
      write: this.db
        .prepare(
          'UPDATE vc_crm_opportunities SET revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
        )
        .bind(now, input.id, input.site, input.expectedRevision),
      dependent,
      result: { id: input.id },
    })
  }
}
