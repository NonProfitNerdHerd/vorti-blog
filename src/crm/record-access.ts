import { OrganizationRepository, SiteAccessError } from '../organizations/repository'

import { crmRecordLink, type CRMRecordLink } from './record-model'

import { crmRecordRulesV3 as records } from './record-context-v3'
import { scopeImportRun } from './import-access'
import { importDomains } from './import-model'

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
      rule = records[link.type],
      importScope = link.type === 'import-run' ? await scopeImportRun(this.db, this.actor, siteID, link.id, operation) : null,
      category = importScope ? importDomains[importScope.run.domain].category : rule.category
    const site = await this.authority.require(siteID, category, operation)
    const identity = await this.authority.require(siteID, 'identity', 'read')
    if (identity.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    const record = await this.db
      .prepare(rule.sql)
      .bind(siteID, link.id)
      .first<{ id: string; label: string; revision: number }>()
    if (!record) throw new SiteAccessError()
    if (link.type === 'import-run' || link.type === 'correspondence-batch') {
      const table = link.type === 'import-run' ? 'vc_crm_import_runs' : 'vc_crm_correspondence_batches'
      const owned = await this.db.prepare(`SELECT 1 FROM ${table} WHERE site_id=? AND id=? AND actor_id=?`).bind(siteID, link.id, this.actor).first()
      if (!owned) throw new SiteAccessError()
    }
    if (link.type === 'volunteer-invitation') {
      await this.authority.require(siteID, 'communications', operation)
      await this.authority.require(siteID, 'restricted-activity', 'read')
    }
    if (link.type === 'volunteer-participation') await this.authority.require(siteID, 'restricted-activity', 'read')
    if (link.type === 'volunteer-hours') await this.authority.require(siteID, 'restricted-activity', 'read')
    if (link.type === 'correspondence-batch') {
      const flags = await this.db.prepare('SELECT financial,membership FROM vc_crm_correspondence_batches WHERE site_id=? AND id=?').bind(siteID, link.id).first<{ financial: number; membership: number }>()
      if (flags?.financial) await this.authority.require(siteID, 'finances', 'read')
      if (flags?.membership) await this.authority.require(siteID, 'memberships', 'read')
    }
    if (link.type === 'correspondence-document') {
      const flags = await this.db.prepare('SELECT financial,membership FROM vc_crm_documents WHERE site_id=? AND id=?').bind(siteID, link.id).first<{ financial: number; membership: number }>()
      if (flags?.financial) await this.authority.require(siteID, 'finances', operation)
      if (flags?.membership) await this.authority.require(siteID, 'memberships', operation)
    }
    const current = await this.authority.require(siteID, category, operation)
    if (current.authorityRevision !== site.authorityRevision) throw new SiteAccessError()
    return { link, record, category, site }
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
