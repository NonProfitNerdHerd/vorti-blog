import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@/payload.config'
import {
  publicWebsite,
  PUBLIC_SITE_HEADER,
  PUBLIC_PREVIEW_HEADER,
} from '@/organizations/public-website'
import { cmsSiteContext } from '@/organizations/cms-scope'
import { tenantAuthorityActive } from '@/organizations/tenant-runtime'

export const publicSiteContext = cache(async () => {
  let requestHeaders: Headers
  try {
    requestHeaders = await headers()
  } catch {
    requestHeaders = new Headers()
  }
  const site = requestHeaders.get(PUBLIC_SITE_HEADER) || 'default'
  const payload = await getPayload({ config })
  const db = (payload.db as unknown as { client: D1Database }).client
  if (site === 'default' && !await tenantAuthorityActive(db, site))
    return {
      site: 'default',
      prefix: '',
      context: cmsSiteContext('default'),
      user: undefined,
      preview: false,
      website: undefined,
    }
  const preview = requestHeaders.get(PUBLIC_PREVIEW_HEADER) === '1'
  let user
  if (preview) {
    user = (await payload.auth({ headers: requestHeaders })).user
    if (!user) notFound()
    const { OrganizationRepository } = await import('@/organizations/repository')
    await new OrganizationRepository(db, Number(user.id)).require(site, 'content', 'read')
  }
  const website = await publicWebsite(db, site, preview)
  if (!website) notFound()
  return {
    site,
    prefix: site === 'default' ? '' : `/sites/${website.route_key}`,
    context: cmsSiteContext(site),
    website,
    user,
    preview,
  }
})

export async function publicPath(path: string) {
  const { prefix, preview } = await publicSiteContext()
  const result =
    path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/sites/')
      ? prefix + path
      : path
  return preview && result.startsWith(prefix + '/')
    ? result + (result.includes('?') ? '&' : '?') + 'preview=1'
    : result
}
