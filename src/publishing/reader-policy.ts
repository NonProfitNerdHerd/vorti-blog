import { APIError, type PayloadRequest, type Where } from 'payload'
import { cmsDatabase } from '../organizations/cms-scope'
import { claimRequest } from '../organizations/identity-authority'
import { TenantRepository } from '../organizations/tenant-repository'
import type { Permission } from '../organizations/permission-catalog'
import { audienceTablesV1 } from './audience-schema-v1'
import { readersView } from './readers-schema-v1'

const requestReaders = Symbol.for('vorticause.server-request-readers')
/** Read-only, request-local policy snapshot. Every reuse still checks the live
 * authority revision; revocation invalidates the request instead of refreshing
 * its authority halfway through rendering. Returned snapshots cannot mutate it.
 */
class RequestReaderRepository extends TenantRepository {
  private snapshots = new Map<string, Awaited<ReturnType<TenantRepository['snapshot']>>>()
  override async snapshot(site: string) {
    const cached = this.snapshots.get(site)
    if (cached) {
      await this.assertRevision(cached.policy.tenant, cached.revision)
      return structuredClone(cached)
    }
    const snapshot = await super.snapshot(site)
    this.snapshots.set(site, structuredClone(snapshot))
    return snapshot
  }
}

async function loadReaderAuthority(req: PayloadRequest, site: string) {
  if (!req.user) throw new APIError('Content unavailable.', 404)
  const repository = new RequestReaderRepository(cmsDatabase(req), Number(req.user.id))
  const authority = await repository.require(site, 'intranet:read')
  let history = false
  try { await repository.require(site, 'intranet:read-history'); history = true }
  catch (error) { if (Number((error as { status?: number }).status) !== 403) throw error }
  return { repository, authority, history, actor: Number(req.user.id) }
}

export async function internalReaderAuthority(req: PayloadRequest, site: string) {
  if (!req.user) throw new APIError('Content unavailable.', 404)
  const context = req.context as Record<symbol, unknown>
  const readers = (context[requestReaders] ||= new Map()) as Map<string, ReturnType<typeof loadReaderAuthority>>
  const key = `${Number(req.user.id)}:${site}`
  if (!readers.has(key)) readers.set(key, loadReaderAuthority(req, site))
  return readers.get(key)!
}

export async function nativeReaderPredicate(req: PayloadRequest, collection: string, site: string, options: { internal: boolean; versions: boolean; mutation: boolean }): Promise<Where> {
  const prefix = options.versions ? 'parent.publishingReadability' : 'publishingReadability'
  const versioned = Boolean(audienceTablesV1.find(([slug]) => slug === collection)?.[2])
  const conditions: Where[] = [{ [`${prefix}.validStructure`]: { equals: true } }]
  if (options.internal) {
    const scope = await internalReaderAuthority(req, site)
    if (options.versions && !scope.history) throw new APIError('History unavailable.', 403)
    conditions.push({ [`${prefix}.actor`]: { equals: scope.actor } })
    if (!scope.authority.privateRead) conditions.push({ [`${prefix}.ordinaryAccess`]: { equals: true } })
    if (!scope.history) conditions.push({ [`${prefix}.publishedTree`]: { equals: true } })
    if (options.mutation && versioned && !scope.history) conditions.push({ [`${prefix}.draftFree`]: { equals: true } })
    await scope.repository.read({ site, permission: 'intranet:read', resource: `${collection}:query`, privateRecord: true, recordAccess: true }, async (): Promise<void> => {})
  } else {
    conditions.push({ [`${prefix}.actor`]: { equals: 0 } })
    const claim = req.user ? await claimRequest(req, site) : null
    const permission = collection === 'site-templates' ? 'administration:templates' : collection === 'saved-views' ? 'administration:saved-views' : `${collection}:read-history` as Permission
    const history = Boolean(req.user && (!claim?.permissions || claim.permissions.includes(permission)))
    if (!options.versions && !history) conditions.push({ [`${prefix}.publishedTree`]: { equals: true } })
    if (options.mutation && versioned && !history) conditions.push({ [`${prefix}.draftFree`]: { equals: true } })
    if (options.versions) conditions.push({ 'version.audience': { equals: 'public' } })
  }
  return { and: conditions }
}

export async function assertInternalReader(req: PayloadRequest, collection: string, site: string, id: number) {
  const mapping = audienceTablesV1.find(([slug]) => slug === collection)
  if (!mapping) throw new APIError('Content unavailable.', 404)
  const scope = await internalReaderAuthority(req, site)
  await scope.repository.read({ site, permission: 'intranet:read', resource: `${collection}:${id}`, privateRecord: true, recordAccess: true }, async (): Promise<void> => {
    const allowed = await cmsDatabase(req).prepare(`SELECT record_id FROM "${readersView(mapping[1])}" WHERE record_id=? AND site=? AND actor=? AND valid_structure=1${scope.authority.privateRead ? '' : ' AND ordinary_access=1'}${scope.history ? '' : ' AND published_tree=1'}`)
      .bind(id, site, scope.actor).first()
    if (!allowed) throw new APIError('Content unavailable.', 403)
  })
}
