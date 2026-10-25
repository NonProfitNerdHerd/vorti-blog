import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { correspondenceTemplate } from './correspondence-model'
import { commitCRM, replayCRM } from './mutations'

export interface TemplateRow {
  id: string
  name: string
  kind: string
  archived: number
  revision: number
  version_id: string
  subject: string
  body: string
}
export class CorrespondenceRepository {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  async templates(siteID: string, after = '', archived = false) {
    const site = await this.authority.require(siteID, 'communications', 'read')
    const rows = await this.db
      .prepare(
        `SELECT t.id,t.name,t.kind,t.archived,t.revision,v.id AS version_id,v.subject,v.body
      FROM vc_crm_templates t JOIN vc_crm_template_versions v ON v.template_id=t.id AND v.revision=t.revision
      WHERE t.site_id=? AND t.archived=? AND t.id>? ORDER BY t.id LIMIT 51`,
      )
      .bind(siteID, archived ? 1 : 0, after)
      .all<TemplateRow>()
    const canEdit = (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    const current = await this.authority.require(siteID, 'communications', 'read')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return {
      docs: rows.results.slice(0, 50),
      next: rows.results.length > 50 ? rows.results[49].id : null,
      canEdit,
    }
  }
  async saveTemplate(input: {
    site: string
    id?: string
    expectedRevision?: number
    operationKey: string
    values: Record<string, unknown>
  }) {
    const site = await this.authority.require(input.site, 'communications', 'edit')
    const values = correspondenceTemplate(input.values)
    const intent = {
      id: input.id || null,
      expectedRevision: input.expectedRevision ?? null,
      ...values,
    }
    const action = input.id ? 'template.updated' : 'template.created'
    const replay = await replayCRM(this.db, this.actor, input.operationKey, {
      site: input.site,
      action,
      type: 'correspondence-template',
      intent,
    })
    if (replay) return replay
    const id = input.id || crypto.randomUUID(),
      version = crypto.randomUUID(),
      now = new Date().toISOString()
    let before: { revision: number; kind: string } | null = null
    if (input.id) {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision! < 1)
        throw new SiteConflictError()
      before = await this.db
        .prepare('SELECT revision,kind FROM vc_crm_templates WHERE id=? AND site_id=?')
        .bind(id, input.site)
        .first()
      if (!before) throw new SiteAccessError()
      if (before.kind !== values.kind)
        throw new Error('Use a new template to change the correspondence type.')
      if (before.revision !== input.expectedRevision) throw new SiteConflictError()
    }
    const revision = (before?.revision || 0) + 1
    const write = input.id
      ? this.db
          .prepare(
            'UPDATE vc_crm_templates SET name=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND site_id=? AND revision=?',
          )
          .bind(values.name, values.archived ? 1 : 0, now, id, input.site, input.expectedRevision!)
      : this.db
          .prepare(
            'INSERT INTO vc_crm_templates(id,site_id,name,kind,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(id, input.site, values.name, values.kind, values.archived ? 1 : 0, now, now)
    return commitCRM({
      db: this.db,
      actor: this.actor,
      key: input.operationKey,
      site: input.site,
      organization: site.organization_id,
      authorityRevision: site.authorityRevision,
      action,
      type: 'correspondence-template',
      id,
      before,
      after: intent,
      intent,
      write,
      dependent: [
        this.db
          .prepare(
            'INSERT INTO vc_crm_template_versions(id,template_id,revision,subject,body,actor_id,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(version, id, revision, values.subject, values.body, this.actor, now),
      ],
      result: { id, revision, version },
    })
  }
}
