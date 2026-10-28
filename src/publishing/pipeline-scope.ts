import { APIError, type Payload, type PayloadRequest, type Where } from 'payload'
import { cmsSiteContext } from '../organizations/cms-scope'
import { audienceTablesV1 } from './audience-schema-v1'
import { CMS_AUDIENCE, CMS_EXPORT_WRITE, CMS_PUBLIC_RENDER, type Audience } from './readership'
import type { Permission } from '../organizations/permission-catalog'
import { claimRequest } from '../organizations/identity-authority'
import { TenantRepository } from '../organizations/tenant-repository'
import { cmsDatabase } from '../organizations/cms-scope'
import { collectExportRecords } from './export-manifest'
import { scopedCMS } from '../organizations/cms-collections'

const pinnedPipeline = Symbol.for('vorticause.server-publishing-pipeline')
const operations = new Set(['find', 'findByID', 'count', 'findVersions', 'findVersionByID', 'countVersions', 'create', 'update', 'delete'])
type PipelineState = { site: string; audience: Audience; fatal?: unknown }
export function assertPublishingPipeline(req: PayloadRequest) {
  const state = (req.context as Record<symbol, unknown>)[pinnedPipeline] as PipelineState | undefined
  if (state?.fatal) throw state.fatal
}

export function publishingPipelineAllowed(req: PayloadRequest, permissions: Permission[], action: 'import' | 'export', target: string, drafts = false) {
  if (!['posts', 'pages'].includes(target)) return false
  if ((req.context as Record<symbol, unknown>)[CMS_AUDIENCE] === 'intranet')
    return (action === 'import' ? ['intranet:read', 'intranet:read-history', 'intranet:create', 'intranet:edit'] : ['intranet:read', 'intranet:read-history']).every(permission => permissions.includes(permission as Permission))
  return permissions.includes(`${target}:${action}` as Permission) && (action !== 'export' ||
    (permissions.includes(`${target}:read-history` as Permission) || (!drafts && permissions.includes(`${target}:read-published` as Permission))))
}

export async function publicPipelineReadership(req: PayloadRequest, site: string, collection: 'imports' | 'exports'): Promise<Where> {
  if (!req.user) return { id: { equals: -1 } }
  const claim = await claimRequest(req, site)
  const adminSources = claim?.tenantAdministrator ? (['posts', 'pages'] as const).filter(source =>
    claim.permissions?.includes(`${source}:read-history`) && claim.permissions.includes(`${source}:${collection === 'imports' ? 'import' : 'export'}`)) : []
  if (adminSources.length) await new TenantRepository(cmsDatabase(req), Number(req.user.id)).read({ site,
    permission: `${adminSources[0]}:read-history`, resource: `${collection}:private-files`, privateRecord: true, recordAccess: false }, async (): Promise<void> => {})
  const ownership: Where = { or: [{ publishingOwner: { equals: Number(req.user.id) } }, ...(adminSources.length ? [{ collectionSlug: { in: adminSources } }] : [])] }
  if (collection === 'imports') return ownership
  const drafts: Where = { or: [{ drafts: { not_equals: 'yes' } }, { drafts: { exists: false } },
    ...(['posts', 'pages'] as const).filter(source => claim?.permissions?.includes(`${source}:read-history`)).map(source => ({ collectionSlug: { equals: source } }))] }
  return { and: [ownership, drafts] }
}

/** The installed import/export plugin calls Local API without its original req.
 * Pin those calls to the initiating request's actor, site and area; a changed
 * staff preference or a client-supplied filter must not retarget the operation.
 */
export function pinPublishingPipeline(req: PayloadRequest, site: string, audience: Audience) {
  if (!req.user) throw new APIError('Sign in to import or export content.', 401)
  const context = req.context as Record<string | symbol, unknown>
  const current = context[pinnedPipeline] as PipelineState | undefined
  if (current) {
    if (current.site !== site || current.audience !== audience) throw new APIError('Publishing scope changed during import or export.', 409)
    return
  }
  const state: PipelineState = { site, audience }
  context[pinnedPipeline] = state
  const base = req.payload
  const proxy = new Proxy(base, { get(target, property) {
    const method = Reflect.get(target, property, target)
    if (typeof property === 'string' && operations.has(property) && typeof method === 'function') return async (options: Record<string, unknown>) => {
      const collection = String(options.collection || '')
      if (!scopedCMS.has(collection)) return method.call(target, options)
      if (context[CMS_EXPORT_WRITE] && ['create', 'update', 'delete'].includes(property) && collection !== 'exports') throw new APIError('Export file creation cannot modify source content.', 403)
      if (options.user && Number((options.user as { id?: number }).id) !== Number(req.user!.id)) throw new APIError('Import or export identity changed.', 403)
      const source = options.req && typeof options.req === 'object' ? options.req as PayloadRequest : req
      const local = { ...source, payload: proxy, user: req.user, headers: source.headers, url: source.url,
        context: { ...source.context, ...cmsSiteContext(site), [CMS_AUDIENCE]: audience, ...(audience === 'public' ? { [CMS_PUBLIC_RENDER]: true } : {}) } } as PayloadRequest
      const data = options.data && typeof options.data === 'object' ? options.data as Record<string, unknown> : null
      if (['create', 'update'].includes(property) && data?.audience != null && data.audience !== audience) throw new APIError('Import records must stay in the selected publishing area. Use Copy or Move separately.', 409)
      if (['update', 'delete'].includes(property) && ['posts', 'pages'].includes(collection) && options.id != null) {
        if (!Number.isSafeInteger(Number(options.id)) || Number(options.id) < 1) throw new APIError('Choose a valid import record.', 400)
        const stored = await cmsDatabase(req).prepare(`SELECT platform_site,audience FROM "${collection}" WHERE id=?`).bind(Number(options.id)).first<{ platform_site: string; audience: string }>()
        if (stored && (stored.platform_site !== site || stored.audience !== audience)) throw new APIError('An import cannot update records outside its selected site and publishing area.', 403)
      }
      const owned = audienceTablesV1.some(([slug]) => slug === collection)
      assertPublishingPipeline(req)
      try {
        const result = await method.call(target, { ...options, ...(property === 'create' && data && owned ? { data: { ...data, audience } } : {}), req: local, user: req.user, context: local.context, overrideAccess: false })
        if (property === 'find' || property === 'findByID') collectExportRecords(req, collection, result)
        return result
      } catch (error) {
        // Upstream treats every count failure as permission denial. Preserve
        // actual database/runtime failures so they cannot become empty exports.
        if (![403, 404].includes(Number((error as { status?: number }).status))) state.fatal = error
        throw error
      }
    }
    return typeof method === 'function' ? method.bind(target) : method
  } }) as Payload
  req.payload = proxy
}
