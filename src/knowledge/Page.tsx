import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createLocalReq, getPayload } from 'payload'
import config from '@/payload.config'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { claimRequest } from '../organizations/identity-authority'
import { PUBLIC_SITE_HEADER, PUBLIC_PREFIX_HEADER } from '../organizations/public-site-headers'
import { KnowledgeRepository } from './repository'
import { KnowledgeWorkspace } from './KnowledgeWorkspace'
import type { KnowledgeKind } from './content'
import { emptyKnowledgeBody } from './content'
import { wikiLoginURL, wikiView } from './wiki-view'

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
  const claim = user ? await claimRequest(req, site) : null
  const permissions = claim?.permissions || []
  const requestedView = wikiView(query.view, query.manage)
  const view =
    user &&
    query.view == null &&
    query.manage === '1' &&
    !permissions.includes(`${kind}:edit`) &&
    !permissions.includes(`${kind}:create`)
      ? 'history'
      : requestedView
  const manage = view !== 'read',
    history = manage && permissions.includes(`${kind}:read-history`)
  const repo = new KnowledgeRepository(cmsDatabase(req), user ? Number(user.id) : null),
    id = route.path?.[0] || ''
  const prefix = requestHeaders.get(PUBLIC_PREFIX_HEADER) || ''
  const destinationQuery = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach(item => destinationQuery.append(key, item))
    else if (typeof value === 'string') destinationQuery.set(key, value)
  }
  destinationQuery.set('site', site)
  if (!destinationQuery.has('view')) destinationQuery.set('view', view)
  const destination = `${prefix}/${kind}${route.path?.length ? '/' + route.path.map(encodeURIComponent).join('/') : ''}?${destinationQuery}`
  if (manage && !user) redirect(wikiLoginURL(destination))
  if (
    manage &&
    (!permissions.includes(`${kind}:read-history`) ||
      (view === 'edit' &&
        (id
          ? !permissions.includes(`${kind}:edit`)
          : query.new === '1'
            ? !permissions.includes(`${kind}:create`)
            : !permissions.includes(`${kind}:edit`) && !permissions.includes(`${kind}:create`))))
  )
    notFound()
  let initial,
    initialDoc = null,
    initialVersions: Awaited<ReturnType<KnowledgeRepository['versions']>> = []
  try {
    if (id) initialDoc = await repo.get(site, kind, id, history)
    initial = await repo.list(site, kind, { history })
    if (id && view === 'history') initialVersions = await repo.versions(site, kind, id)
    if (!id && view === 'edit' && query.new === '1')
      initialDoc = {
        id: crypto.randomUUID(),
        title: '',
        slug: '',
        parent: null,
        body: emptyKnowledgeBody,
        visibility: 'private' as const,
        revision: 0,
        published: false,
        attachments: [],
      }
  } catch (error) {
    if ([403, 404].includes(Number((error as { status?: number }).status))) notFound()
    throw error
  }
  return (
    <KnowledgeWorkspace
      key={`${site}:${id}:${view}:${query.new || ''}`}
      site={site}
      kind={kind}
      prefix={prefix}
      id={id}
      permissions={permissions}
      initial={initial as Parameters<typeof KnowledgeWorkspace>[0]['initial']}
      manage={manage}
      view={view}
      initialDoc={initialDoc as Parameters<typeof KnowledgeWorkspace>[0]['initialDoc']}
      initialVersions={
        initialVersions as Parameters<typeof KnowledgeWorkspace>[0]['initialVersions']
      }
      account={user ? { label: user.username || user.email || 'Account' } : null}
      loginHref={wikiLoginURL(destination)}
    />
  )
}
