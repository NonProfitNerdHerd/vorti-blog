import { OrganizationRepository, SiteAccessError } from '../organizations/repository'

import { crmRecordLink, type CRMRecordLink } from './record-model'

import { crmRecordRulesV1 as records } from './record-context-v1'

/** Resolve private references before exposing even a cached label, count or filename.
 * Contact-linked files and Tasks are private communications rather than shared identity data.
 * Callers must also enforce their own file/workspace permissions and fence the returned authority epoch.
 */
export class CRMRecordAccess {
  private authority: OrganizationRepository
  constructor(
    private db: D1Database,
    private actor: number,
  ) {
    this.authority = new OrganizationRepository(db, actor)
  }
  async resolve(siteID: string, rawLink: CRMRecordLink, operation: 'read' | 'edit' = 'read') {
    const link = crmRecordLink(rawLink.type, rawLink.id),
      rule = records[link.type]
    const site = await this.authority.require(siteID, rule.category, operation)
    const identity = await this.authority.require(siteID, 'identity', 'read')
    if (identity.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    const record = await this.db
      .prepare(rule.sql)
      .bind(siteID, link.id)
      .first<{ id: string; label: string; revision: number }>()
    if (!record) throw new SiteAccessError()
    const current = await this.authority.require(siteID, rule.category, operation)
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return { link, record, category: rule.category, site }
  }
  /** Include these statements in the same atomic batch as the linked record write.
   * The organization epoch guard belongs to commitCRM; this guard also fences contact/affiliation revocation.
   */
  guard(siteID: string, rawLink: CRMRecordLink, key: string): D1PreparedStatement[] {
    const link = crmRecordLink(rawLink.type, rawLink.id)
    return [
      this.db
        .prepare(
          `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM (${records[link.type].sql})`,
        )
        .bind(key, siteID, link.id),
      this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
    ]
  }
}
