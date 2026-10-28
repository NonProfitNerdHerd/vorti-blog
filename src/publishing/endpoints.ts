import { APIError, type Endpoint, type PayloadRequest } from 'payload'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { TenantRepository } from '../organizations/tenant-repository'
import { AUTHORITY_MUTATION_COMMITTED } from '../organizations/authority-plugin'
import { readBoundedJSON } from '../forms/security'
import { errorResponse } from '../crm/plugin'
import { CMS_AUDIENCE } from './readership'
import { PublishingGroups } from './groups'
import { INTERNAL_MEDIA_PREFIX } from './storage'
import { PublishingSharing } from './sharing'
import { publishingRequestSite } from './request-site'
import { PublishingTransfers } from './transfers'
import { revalidatePath } from 'next/cache'
import { privatePublishingHistory } from './private-history'
import { claimRequest } from '../organizations/identity-authority'
import { authorizeExportManifest } from './export-manifest'

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }
function scope(req: PayloadRequest) {
  if (!req.user || req.user.collection !== 'users') throw new APIError('Sign in to use Intranet.', 401)
  const site = publishingRequestSite(req.url!, req.headers)
  return { site, db: cmsDatabase(req), actor: Number(req.user.id) }
}

async function protectedPublishingFile(req: PayloadRequest, storage: R2Bucket, collection: string) {
  if (!req.user || req.user.collection !== 'users' || !['media', 'imports', 'exports'].includes(collection)) throw new APIError('File unavailable.', 404)
  const { site, db, actor } = scope(req), id = Number(req.routeParams?.id)
  if (!Number.isSafeInteger(id) || id < 1) throw new APIError('File unavailable.', 404)
  const repository = new TenantRepository(db, actor)
  const local = { ...req, context: { ...cmsSiteContext(site), [CMS_AUDIENCE]: 'intranet' } }
  const doc = await req.payload.findByID({ collection: collection as 'media' | 'imports' | 'exports', id, req: local, depth: 0, overrideAccess: false })
  const metadata = await db.prepare(`SELECT prefix FROM "${collection}" WHERE id=? AND platform_site=? AND audience=?`).bind(id, site, doc.audience).first<{ prefix: string | null }>()
  if ((collection === 'media' && doc.audience !== 'intranet') || !metadata?.prefix?.startsWith(INTERNAL_MEDIA_PREFIX) || !doc.filename) throw new APIError('File unavailable.', 404)
  const size = new URL(req.url!).searchParams.get('size'), sizes = (doc as unknown as { sizes?: Record<string, { filename?: string }> }).sizes
  const filename = size && collection === 'media' ? sizes?.[size]?.filename : size ? null : doc.filename
  if (!filename || filename.includes('/') || filename.includes('\\')) throw new APIError('File unavailable.', 404)
  const object = await storage.get(`${metadata.prefix}/${filename}`)
  if (!object) throw new APIError('File unavailable.', 404)
  try {
    if (collection === 'exports') await authorizeExportManifest(req, site, id)
    const authority = await claimRequest(local, site)
    if (!authority) throw new APIError('File unavailable.', 403)
    await repository.assertRevision(authority.organization, authority.epoch)
  } catch (error) { await object.body.cancel(); throw error }
  const type = object.httpMetadata?.contentType || 'application/octet-stream'
  const downloadName = (doc as unknown as { publishingOriginalFilename?: string }).publishingOriginalFilename || filename
  return new Response(object.body, { headers: { ...privateHeaders, 'Content-Type': type,
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': `${type.startsWith('image/') && type !== 'image/svg+xml' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(downloadName)}` } })
}

export const publishingEndpoints = (storage: R2Bucket): Endpoint[] => [
  { path: '/publishing/private-history', method: 'get', handler: async req => {
    try {
      const { site } = scope(req)
      return Response.json(await privatePublishingHistory(req, site), { headers: privateHeaders })
    } catch (error) { return errorResponse(error) }
  } },
  { path: '/publishing/transfer', method: 'get', handler: async req => {
    try {
      const { site } = scope(req), params = new URL(req.url!).searchParams
      const result = await new PublishingTransfers(req).read(site, params.get('collection') as 'posts' | 'pages', Number(params.get('id')))
      return Response.json({ revision: result.revision, authorityRevision: result.authorityRevision, audience: result.audience, slug: result.row.slug }, { headers: privateHeaders })
    } catch (error) { return errorResponse(error) }
  } },
  { path: '/publishing/transfer', method: 'post', handler: async req => {
    try {
      const { site } = scope(req)
      if (req.headers.get('origin') !== new URL(req.url!).origin) throw new APIError('Use the signed-in site to copy or move content.', 403)
      const body = await readBoundedJSON(req, 64000)
      const result = await new PublishingTransfers(req).execute({ ...body, site } as Parameters<PublishingTransfers['execute']>[0])
      ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
      revalidatePath('/', 'layout')
      return Response.json(result, { headers: privateHeaders })
    } catch (error) { return errorResponse(error) }
  } },
  { path: '/publishing/sharing', method: 'get', handler: async req => {
    try {
      const { site } = scope(req), params = new URL(req.url!).searchParams
      const { readership, people, groups, revision, authorityRevision, published } = await new PublishingSharing(req).read(site, params.get('collection') || '', Number(params.get('id')))
      return Response.json({ readership, people, groups, revision, authorityRevision, published }, { headers: privateHeaders })
    } catch (error) { return errorResponse(error) }
  } },
  { path: '/publishing/sharing', method: 'post', handler: async req => {
    try {
      const { site } = scope(req)
      if (req.headers.get('origin') !== new URL(req.url!).origin) throw new APIError('Use the signed-in site to change sharing.', 403)
      const body = await readBoundedJSON(req, 64000)
      const result = await new PublishingSharing(req).save({ ...body, site } as Parameters<PublishingSharing['save']>[0])
      ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
      return Response.json(result, { headers: privateHeaders })
    } catch (error) { return errorResponse(error) }
  } },
  {
    path: '/publishing/groups', method: 'get', handler: async req => {
      try {
        const { site, db, actor } = scope(req), groups = new PublishingGroups(db, actor)
        const result = new URL(req.url!).searchParams.has('capability') ? { canManage: await groups.canManage(site) } : await groups.list(site)
        return Response.json(result, { headers: privateHeaders })
      }
      catch (error) { return errorResponse(error) }
    },
  },
  {
    path: '/publishing/groups', method: 'post', handler: async req => {
      try {
        const { site, db, actor } = scope(req)
        if (req.headers.get('origin') !== new URL(req.url!).origin) throw new APIError('Use the signed-in site to manage sharing.', 403)
        const body = await readBoundedJSON(req, 64000)
        const result = await new PublishingGroups(db, actor).save({ ...body, site } as Parameters<PublishingGroups['save']>[0])
        ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
        return Response.json(result, { headers: privateHeaders })
      } catch (error) { return errorResponse(error) }
    },
  },
  {
    path: '/publishing/readers', method: 'get', handler: async req => {
      try {
        const { site, db, actor } = scope(req)
        const repository = new TenantRepository(db, actor), authority = await repository.require(site, 'intranet:read')
        const [people, groups] = await Promise.all([
          db.prepare(`SELECT u.id,COALESCE(NULLIF(u.display_name,''),u.username) name FROM users u
            JOIN vc_tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND m.active=1
            AND EXISTS(SELECT 1 FROM vc_tenant_user_sites permitted WHERE permitted.user_id=u.id AND permitted.site=?)
            AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=u.id AND a.disabled=1) ORDER BY name LIMIT 501`).bind(authority.tenant, site).all(),
          db.prepare('SELECT id,name FROM vc_publishing_groups WHERE tenant_id=? AND site_id=? AND retired=0 ORDER BY name LIMIT 101').bind(authority.tenant, site).all(),
        ])
        if (people.results.length > 500 || groups.results.length > 100) throw new APIError('Narrow the sharing recipient search.', 400)
        await repository.assertRevision(authority.tenant, authority.revision)
        return Response.json({ people: people.results, groups: groups.results }, { headers: privateHeaders })
      } catch (error) { return errorResponse(error) }
    },
  },
  {
    path: '/publishing/media/:id', method: 'get', handler: async req => {
      try { return await protectedPublishingFile(req, storage, 'media') } catch (error) { return errorResponse(error) }
    },
  },
  { path: '/publishing/files/:collection/:id', method: 'get', handler: async req => {
    try { return await protectedPublishingFile(req, storage, String(req.routeParams?.collection || '')) } catch (error) { return errorResponse(error) }
  } },
]
