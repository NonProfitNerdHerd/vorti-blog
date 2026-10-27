import type { PayloadRequest, Where } from 'payload'
import { cmsSiteContext } from '../organizations/cms-scope'
import { claimRequest } from '../organizations/identity-authority'
import { SiteConflictError } from '../organizations/atomic'
import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { workspaceReq, requireTask } from '../review/workspace-access'
import { crmRecordLink, type CRMRecordLink } from './record-model'
import { ContactRepository } from './contacts'
import { authorizeCRMTaskActor, crmTaskIntentHash, crmTaskWrite } from './task-access'
import { calendarDate } from './finance'
import { crmTaskInternalRead } from './task-where'
import { tenantAuthorityActive } from '../organizations/tenant-runtime'

export type CreateCRMTask = {
  site: string
  link: CRMRecordLink
  expectedRevision: number
  expectedAuthorityRevision: number
  operationKey: string
  title: string
  description?: string
  assignee?: number | null
  dueOn?: string
  activity?: string | null
}
/** Uses native Tasks for storage, assignment, discussion, files and completion.
 * CRM only owns the immutable typed link and its additional access predicate. */
export class CRMTasks {
  constructor(
    private db: D1Database,
    private request: PayloadRequest,
  ) {}
  private get actor() {
    if (!this.request.user || this.request.user.collection !== 'users') throw new SiteAccessError()
    return Number(this.request.user.id)
  }
  private async req(site: string, write = false) {
    const req = {
      ...this.request,
      query: { ...this.request.query },
      context: {
        ...this.request.context,
        ...cmsSiteContext(site),
        [crmTaskInternalRead]: true,
        ...(write ? { [crmTaskWrite]: true } : {}),
      },
    } as PayloadRequest
    await claimRequest(req)
    return req
  }
  private async scope(site: string, link: CRMRecordLink) {
    const authority = new OrganizationRepository(this.db, this.actor)
    if (link.type === 'contact') {
      const contact = await new ContactRepository(this.db, this.actor).get(site, link.id),
        access = await authority.require(site, 'workspace', 'read')
      return {
        site: access,
        record: { id: contact.id, label: contact.label, revision: contact.revision },
      }
    }
    return authorizeCRMTaskActor(this.db, this.actor, site, link)
  }
  private async fence(site: string, link: CRMRecordLink, epoch: number) {
    if ((await this.scope(site, link)).site.authorityRevision !== epoch) throw new SiteAccessError()
  }

  async list(site: string, raw: CRMRecordLink, page = 1, state = 'open') {
    const link = crmRecordLink(raw.type, raw.id),
      scope = await this.scope(site, link),
      req = await this.req(site)
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !['all', 'open', 'completed'].includes(state)
    )
      throw new Error('Choose a valid task page and status.')
    const where: Where = {
      and: [
        { crmSite: { equals: site } },
        { parent: { exists: false } },
        ...(link.type === 'contact'
          ? [{ 'crmConstituents.constituent': { equals: link.id } }]
          : [{ crmType: { equals: link.type } }, { crmID: { equals: link.id } }]),
        ...(state === 'all'
          ? []
          : [{ status: state === 'completed' ? { equals: 'done' } : { not_equals: 'done' } }]),
        { archived: { not_equals: true } },
      ],
    }
    const result = await req.payload.find({
      collection: 'review-tasks',
      req,
      overrideAccess: false,
      depth: 0,
      where,
      limit: 20,
      page,
      sort: '-createdAt',
    })
    let canCreate = false
    try {
      await authorizeCRMTaskActor(this.db, this.actor, site, link, 'edit')
      canCreate = true
    } catch (error) {
      if (!(error instanceof SiteAccessError)) throw error
    }
    await this.fence(site, link, scope.site.authorityRevision)
    return {
      docs: result.docs,
      total: result.totalDocs,
      page: result.page,
      totalPages: result.totalPages,
      record: scope.record,
      authorityRevision: scope.site.authorityRevision,
      canCreate,
    }
  }

  async people(site: string, raw: CRMRecordLink, search = '', after = 0) {
    const link = crmRecordLink(raw.type, raw.id),
      scope = await authorizeCRMTaskActor(this.db, this.actor, site, link, 'edit')
    if (
      typeof search !== 'string' ||
      search.length > 80 ||
      !Number.isSafeInteger(after) ||
      after < 0
    )
      throw new Error('Choose a valid assignee search.')
    // Scan bounded candidates from this root only. Authorization decides which
    // names may be returned; unrelated roots never enter the candidate query.
    const tenant = await tenantAuthorityActive(this.db, site)
    const membership = tenant
      ? 'EXISTS(SELECT 1 FROM vc_tenant_memberships membership WHERE membership.user_id=u.id AND membership.active=1 AND membership.tenant_id=?)'
      : 'EXISTS(SELECT 1 FROM vc_installation_operators operator WHERE operator.user_id=u.id) OR EXISTS(SELECT 1 FROM vc_site_memberships membership JOIN vc_sites member_site ON member_site.id=membership.site_id WHERE membership.user_id=u.id AND membership.active=1 AND member_site.organization_id=?)'
    const candidates = await this.db
      .prepare(
        `SELECT u.id,coalesce(nullif(u.attribution_label,''),'Account #'||u.id) AS label FROM users u WHERE u.id>? AND instr(lower(coalesce(nullif(u.attribution_label,''),'Account #'||u.id)),lower(?))>0 AND NOT EXISTS(SELECT 1 FROM vc_account_status disabled WHERE disabled.user_id=u.id AND disabled.disabled=1) AND(${membership}) ORDER BY u.id LIMIT 5`,
      )
      .bind(after, search.trim(), scope.site.organization_id)
      .all<{ id: number; label: string }>()
    const docs: Array<{ id: number; label: string }> = []
    for (const candidate of candidates.results) {
      try {
        await authorizeCRMTaskActor(this.db, candidate.id, site, link, 'edit')
        docs.push(candidate)
      } catch (error) {
        if (!(error instanceof SiteAccessError)) throw error
      }
    }
    await this.fence(site, link, scope.site.authorityRevision)
    return { docs, next: candidates.results.length === 5 ? candidates.results.at(-1)!.id : null }
  }

  async create(input: CreateCRMTask) {
    const link = crmRecordLink(input.link.type, input.link.id),
      scope = await authorizeCRMTaskActor(this.db, this.actor, input.site, link, 'edit')
    if (
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.trim().length > 240 ||
      typeof (input.description ?? '') !== 'string' ||
      (input.description ?? '').length > 20000 ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(input.operationKey)
    )
      throw new Error('Enter a task title, description and valid operation key.')
    if (input.assignee != null && (!Number.isSafeInteger(input.assignee) || input.assignee < 1))
      throw new Error('Choose an authorized assignee.')
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      !Number.isSafeInteger(input.expectedAuthorityRevision)
    )
      throw new Error('Choose the current CRM record before creating a task.')
    const intent = {
        actor: this.actor,
        site: input.site,
        link,
        expectedRevision: input.expectedRevision,
        expectedAuthorityRevision: input.expectedAuthorityRevision,
        title: input.title.trim(),
        description: (input.description ?? '').trim(),
        assignee: input.assignee ?? null,
        dueOn: input.dueOn ? calendarDate(input.dueOn) : '',
        activity: input.activity || null,
      },
      hash = await crmTaskIntentHash(intent),
      req = await this.req(input.site, true)
    const replay = async () => {
      const row = await this.db
        .prepare('SELECT id,creator_id,crm_intent_hash FROM review_tasks WHERE crm_operation_key=?')
        .bind(input.operationKey)
        .first<{ id: number; creator_id: number; crm_intent_hash: string }>()
      if (!row) return null
      if (row.creator_id !== this.actor || row.crm_intent_hash !== hash)
        throw new SiteConflictError()
      await requireTask(req, row.id)
      return { id: row.id }
    }
    const existing = await replay()
    if (existing) return existing
    if (
      scope.record.revision !== input.expectedRevision ||
      scope.site.authorityRevision !== input.expectedAuthorityRevision
    )
      throw new SiteConflictError()
    const data = {
      title: intent.title,
      description: intent.description,
      status: 'open' as const,
      priority: 'normal' as const,
      personal: true,
      documentType: 'none' as const,
      documentID: '',
      assignee: intent.assignee,
      dueDate: intent.dueOn ? `${intent.dueOn}T12:00:00.000Z` : null,
      crmSite: input.site,
      crmType: link.type,
      crmID: link.id,
      crmActivityID: intent.activity,
      crmOperationKey: input.operationKey,
      crmIntentHash: hash,
      crmRecordRevision: input.expectedRevision,
      crmAuthorityRevision: input.expectedAuthorityRevision,
    }
    try {
      const task = await req.payload.create({
        collection: 'review-tasks',
        req: workspaceReq(req),
        overrideAccess: false,
        depth: 0,
        data,
      })
      return { id: task.id }
    } catch (error) {
      const recovered = await replay()
      if (recovered) return recovered
      let cause: unknown = error
      for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
        if (
          /CRM follow-up source or permissions changed|CRM task requires current retained chapter record context/.test(
            cause.message,
          )
        )
          throw new SiteConflictError()
        cause = cause.cause
      }
      throw error
    }
  }
}
