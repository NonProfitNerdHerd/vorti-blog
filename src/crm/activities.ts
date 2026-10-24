import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { calendarDate } from './finance'
import { commitCRM, replayCRM } from './mutations'
import { SiteConflictError } from '../organizations/atomic'
import { activityKinds, type Activity } from './activity-model'
export class ActivityRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async contact(site: string, id: string) {
    const row = await this.db
      .prepare(
        'SELECT a.id FROM vc_crm_affiliations a JOIN vc_crm_constituents c ON c.id=a.constituent_id WHERE a.site_id=? AND a.constituent_id=? AND a.archived=0 AND c.archived=0',
      )
      .bind(site, id)
      .first()
    if (!row) throw new SiteAccessError()
  }
  async list(siteID: string, contact: string, after = '') {
    const site = await this.authority.require(siteID, 'communications', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    await this.contact(siteID, contact)
    const rows = await this.db
      .prepare(
        'SELECT * FROM vc_crm_activities WHERE site_id=? AND constituent_id=? AND id>? ORDER BY id LIMIT 51',
      )
      .bind(siteID, contact, after)
      .all<Activity>()
    const canEdit = (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    const current = await this.authority.require(siteID, 'communications', 'read')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit,
    }
  }
  async save(input: {
    site: string
    contact: string
    id?: string
    expectedRevision?: number
    operationKey: string
    values: Record<string, unknown>
  }) {
    const site = await this.authority.require(input.site, 'communications', 'edit')
    await this.authority.require(input.site, 'identity', 'read')
    await this.contact(input.site, input.contact)
    const values = input.values,
      kind = String(values.kind)
    if (!(activityKinds as readonly string[]).includes(kind))
      throw new Error('Choose a valid communication type.')
    if (
      typeof values.subject !== 'string' ||
      !values.subject.trim() ||
      values.subject.length > 180 ||
      typeof values.body !== 'string' ||
      !values.body.trim() ||
      values.body.length > 16000
    )
      throw new Error('Enter a subject and communication text within the length limits.')
    const subject = values.subject.trim(),
      body = values.body.trim(),
      occurredOn = calendarDate(values.occurredOn),
      archived = values.archived === true ? 1 : 0
    const id = input.id || crypto.randomUUID(),
      action = input.id ? 'activity.updated' : 'activity.created',
      now = new Date().toISOString()
    const intent = {
      contact: input.contact,
      id: input.id || null,
      expectedRevision: input.expectedRevision ?? null,
      kind,
      subject,
      body,
      occurredOn,
      archived,
    }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'communication',
      intent,
    })
    if (replay) return replay
    let before: Activity | null = null,
      write: D1PreparedStatement
    if (input.id) {
      if (!Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
      before = await this.db
        .prepare('SELECT * FROM vc_crm_activities WHERE id=? AND site_id=? AND constituent_id=?')
        .bind(id, input.site, input.contact)
        .first<Activity>()
      if (!before) throw new SiteAccessError()
      write = this.db
        .prepare(
          'UPDATE vc_crm_activities SET kind=?,subject=?,body=?,occurred_on=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
        )
        .bind(
          kind,
          subject,
          body,
          occurredOn,
          archived,
          now,
          id,
          input.site,
          input.expectedRevision!,
        )
    } else
      write = this.db
        .prepare(
          'INSERT INTO vc_crm_activities(id,site_id,constituent_id,kind,subject,body,occurred_on,archived,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          input.site,
          input.contact,
          kind,
          subject,
          body,
          occurredOn,
          archived,
          this.actor,
          now,
          now,
        )
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'communication',
      id,
      before,
      after: intent,
      intent,
      write,
      result: { id },
    })
  }
}
