import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { createLocalReq, getPayload } from 'payload'
import config from '@/payload.config'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { claimRequest } from '../organizations/identity-authority'
import { PUBLIC_SITE_HEADER, PUBLIC_PREFIX_HEADER } from '../organizations/public-site-headers'
import { KnowledgeRepository } from './repository'
import { KnowledgeWorkspace } from './KnowledgeWorkspace'
import type { KnowledgeKind } from './content'

export async function KnowledgePage({
  kind,
  params,
  searchParams,
}: {
  kind: KnowledgeKind
  params: Promise<{ path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [route, query, requestHeaders] = await Promise.all([params, searchParams, headers()])
  const payload = await getPayload({ config }),
    user = (await payload.auth({ headers: requestHeaders })).user
  const site =
    requestHeaders.get(PUBLIC_SITE_HEADER) ||
    (typeof query.site === 'string' ? query.site : 'default')
  const req = await createLocalReq({ user, context: cmsSiteContext(site) }, payload)
  const claim = user ? await claimRequest(req, site) : null,
    manage = query.manage === '1' && !!user
  const permissions = claim?.permissions || [],
    history = manage && permissions.includes(`${kind}:read-history`)
  const repo = new KnowledgeRepository(cmsDatabase(req), user ? Number(user.id) : null),
    id = route.path?.[0] || ''
  let initial
  try {
    if (id) await repo.get(site, kind, id, history)
    initial = await repo.list(site, kind, { history })
  } catch (error) {
    if ([403, 404].includes(Number((error as { status?: number }).status))) notFound()
    throw error
  }
  return (
    <KnowledgeWorkspace
      site={site}
      kind={kind}
      prefix={requestHeaders.get(PUBLIC_PREFIX_HEADER) || ''}
      id={id}
      permissions={permissions}
      initial={initial as Parameters<typeof KnowledgeWorkspace>[0]['initial']}
      manage={manage}
    />
  )
}
