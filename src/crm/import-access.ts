import { OrganizationRepository, SiteAccessError } from '../organizations/repository'
import { importDomains } from './import-model'
import type { ImportRun } from './import-types'

/** Uploads and uncommitted source rows remain private to their recorded owner.
 * Created CRM records retain their ordinary chapter/domain access rules.
 */
export async function scopeImportRun(
  db: D1Database,
  actor: number,
  siteID: string,
  id: string,
  operation: 'read' | 'edit' = 'read',
) {
  const authority = new OrganizationRepository(db, actor),
    identity = await authority.require(siteID, 'identity', 'read')
  const run = await db
    .prepare('SELECT * FROM vc_crm_import_runs WHERE id=? AND site_id=? AND actor_id=?')
    .bind(id, siteID, actor)
    .first<ImportRun>()
  if (!run) throw new SiteAccessError()
  const category = importDomains[run.domain]?.category
  if (!category) throw new SiteAccessError()
  if (
    (await authority.require(siteID, category, 'read')).authorityRevision !==
    identity.authorityRevision
  )
    throw new SiteAccessError()
  if (
    operation === 'edit' &&
    (await authority.require(siteID, category, 'edit')).authorityRevision !==
      identity.authorityRevision
  )
    throw new SiteAccessError()
  if (run.domain === 'volunteer-hours')
    await authority.require(siteID, 'restricted-activity', 'read')
  if (run.financial) await authority.require(siteID, 'finances', 'read')
  const current = await authority.require(siteID, 'identity', 'read')
  if (current.authorityRevision !== identity.authorityRevision) throw new SiteAccessError()
  return { run, site: identity }
}
