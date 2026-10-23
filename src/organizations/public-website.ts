import { disabledAncestorSQL } from './website-schema-v1'
import type { WebsiteRecord } from './websites'

export { PUBLIC_SITE_HEADER, PUBLIC_PREFIX_HEADER, PUBLIC_PREVIEW_HEADER } from './public-site-headers'
export async function publicWebsite(db: D1Database, site: string, preview = false) {
  const row = await db
    .prepare(
      `SELECT w.*,s.route_key,s.name,o.authority_revision,s.organization_id
    FROM vc_site_websites w JOIN vc_sites s ON s.id=w.site_id JOIN vc_organizations o ON o.id=s.organization_id
    WHERE w.site_id=? AND s.archived=0 AND ${preview ? '' : 'w.published=1 AND'} w.initialized=1`,
    )
    .bind(site)
    .first<
      WebsiteRecord & {
        route_key: string
        name: string
        authority_revision: number
        organization_id: string
      }
    >()
  if (!row || (!preview && (await db.prepare(disabledAncestorSQL(false)).bind(site).first())))
    return null
  return row
}
