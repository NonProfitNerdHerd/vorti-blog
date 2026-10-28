import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { SiteConflictError } from '../organizations/atomic'
import { commitCRM, replayCRM } from './mutations'

export type ContactComment = {
  id: string
  body: string
  revision: number
  created_by: number
  author_label: string
  created_at: string
  updated_at: string
  canEdit: boolean
}
type Row = Omit<ContactComment, 'canEdit'>

export class CommentRepository {
  private authority: OrganizationRepository
  constructor(private db: D1Database, private actor: number, private authorLabel = 'Staff member') {
    this.authority = new OrganizationRepository(db, actor)
  }
  private async contact(site: string, id: string) {
    const row = await this.db.prepare(`SELECT 1 FROM vc_crm_affiliations a
      JOIN vc_crm_constituents c ON c.id=a.constituent_id AND c.archived=0
      WHERE a.site_id=? AND a.constituent_id=? AND a.archived=0`).bind(site, id).first()
    if (!row) throw new SiteAccessError()
  }
  async list(siteID: string, contact: string, beforeDate = '', beforeID = '') {
    if ((beforeDate || beforeID) && (!beforeDate || !beforeID || !Number.isFinite(Date.parse(beforeDate)) || beforeID.length > 128))
      throw new Error('Invalid page cursor.')
    const site = await this.authority.require(siteID, 'communications', 'read')
    await this.authority.require(siteID, 'identity', 'read')
    await this.contact(siteID, contact)
    const rows = await this.db.prepare(`SELECT * FROM vc_crm_comments WHERE site_id=? AND constituent_id=?
      ${beforeDate ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''}
      ORDER BY created_at DESC,id DESC LIMIT 51`).bind(siteID, contact, ...(beforeDate ? [beforeDate, beforeDate, beforeID] : [])).all<Row>()
    const canPost = (await this.authority.authority(siteID, 'communications', 'edit')).allowed
    const current = await this.authority.require(siteID, 'communications', 'read')
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return { docs: rows.results.slice(0, 50).map(row => ({ ...row, canEdit: canPost && row.created_by === this.actor })),
      next: rows.results.length > 50 ? { date: rows.results[49].created_at, id: rows.results[49].id } : null, canPost }
  }
  async save(input: { site: string; contact: string; body: string; operationKey: string; id?: string; expectedRevision?: number }) {
    const site = await this.authority.require(input.site, 'communications', 'edit')
    await this.authority.require(input.site, 'identity', 'read')
    await this.contact(input.site, input.contact)
    if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 4000)
      throw new Error('Enter a comment of at most 4,000 characters.')
    const body = input.body.trim()
    const action = input.id ? 'comment.updated' : 'comment.created'
    const intent = { contact: input.contact, id: input.id || null, expectedRevision: input.expectedRevision ?? null, body }
    const replay = await replayCRM(this.db, this.actor, input.operationKey, { site: input.site, action, type: 'contact-comment', intent })
    if (replay) return replay
    const id = input.id || crypto.randomUUID(), now = new Date().toISOString()
    let before: Row | null = null
    let write: D1PreparedStatement
    if (input.id) {
      if (!Number.isSafeInteger(input.expectedRevision)) throw new SiteConflictError()
      before = await this.db.prepare('SELECT * FROM vc_crm_comments WHERE id=? AND site_id=? AND constituent_id=?')
        .bind(id, input.site, input.contact).first<Row>()
      if (!before || before.created_by !== this.actor) throw new SiteAccessError()
      write = this.db.prepare(`UPDATE vc_crm_comments SET body=?,revision=revision+1,updated_at=?
        WHERE id=? AND site_id=? AND constituent_id=? AND created_by=? AND revision=?`)
        .bind(body, now, id, input.site, input.contact, this.actor, input.expectedRevision!)
    } else {
      write = this.db.prepare(`INSERT INTO vc_crm_comments
        (id,site_id,constituent_id,body,created_by,author_label,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(id, input.site, input.contact, body, this.actor, this.authorLabel.slice(0, 160), now, now)
    }
    return commitCRM({ db: this.db, actor: this.actor, key: input.operationKey, site: input.site,
      organization: site.organization_id, authorityRevision: site.authorityRevision,
      action, type: 'contact-comment', id, before, after: { body }, intent, write,
      result: { id, revision: input.id ? input.expectedRevision! + 1 : 1 } })
  }
}
