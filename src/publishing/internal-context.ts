import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { createLocalReq, getPayload } from 'payload'
import config from '@/payload.config'
import { cmsSiteContext } from '../organizations/cms-scope'
import { TenantRepository } from '../organizations/tenant-repository'
import { scopedSettingsForAuthorizedSite } from '../organizations/scoped-settings'
import { PUBLIC_SITE_HEADER } from '../organizations/public-site-headers'
import { CMS_AUDIENCE } from './readership'
export { internalPagePath } from './paths'

export const internalContext = cache(async () => {
  const requestHeaders = await headers(), payload = await getPayload({ config })
  const user = (await payload.auth({ headers: requestHeaders })).user
  if (!user || user.collection !== 'users') notFound()
  const site = requestHeaders.get(PUBLIC_SITE_HEADER) || requestHeaders.get('x-vorticause-site') || 'default'
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(site)) notFound()
  const db = (payload.db as unknown as { client: D1Database }).client
  const authority = new TenantRepository(db, Number(user.id))
  let permitted
  try { permitted = await authority.require(site, 'intranet:read') }
  catch (error) { if (Number((error as { status?: number }).status) === 403) notFound(); throw error }
  const selected = await db.prepare('SELECT route_key,name FROM vc_sites WHERE id=? AND organization_id=?').bind(site, permitted.tenant).first<{ route_key: string; name: string }>()
  if (!selected) notFound()
  const settings = await scopedSettingsForAuthorizedSite(db, site, permitted.tenant)
  await authority.assertRevision(permitted.tenant, permitted.revision)
  const context = { ...cmsSiteContext(site), [CMS_AUDIENCE]: 'intranet' }
  const req = () => createLocalReq({ user, context: { ...context } }, payload)
  return { payload, db, user, site, req, context, prefix: site === 'default' ? '' : `/sites/${selected.route_key}`,
    siteName: selected.name, settings: settings.site.settings, authorityRevision: permitted.revision,
    assertCurrent: () => authority.assertRevision(permitted.tenant, permitted.revision) }
})
