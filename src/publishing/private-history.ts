import { APIError, createLocalReq, type PayloadRequest } from 'payload'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { TenantRepository } from '../organizations/tenant-repository'
import { CMS_AUDIENCE } from './readership'
import { readersView } from './readers-schema-v1'

/** Historical internal bodies never enter the ordinary public version API.
 * This separate authenticated read requires both areas' history permissions,
 * current document access and the old version's still-effective readership.
 */
export async function privatePublishingHistory(req: PayloadRequest, site: string) {
  if (!req.user) throw new APIError('Sign in to read history.', 401)
  const params = new URL(req.url!).searchParams, collection = params.get('collection'), id = Number(params.get('id'))
  const before = Number(params.get('beforeVersion') || Number.MAX_SAFE_INTEGER)
  if (!['posts', 'pages'].includes(collection) || !Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(before) || before < 1) throw new APIError('Choose a valid history document.', 400)
  const selected = collection as 'posts' | 'pages', db = cmsDatabase(req), actor = Number(req.user.id), repository = new TenantRepository(db, actor)
  const internal = await repository.require(site, 'intranet:read-history')
  await repository.require(site, 'intranet:read')
  await repository.require(site, `${selected}:read-history`)
  const local = await createLocalReq({ user: req.user, context: { ...cmsSiteContext(site), [CMS_AUDIENCE]: 'public' } }, req.payload)
  const current = await req.payload.findByID({ collection: selected, id, req: local, draft: true, depth: 0, overrideAccess: false })
  if (current.audience !== 'public' || current.platformSite !== site) throw new APIError('History unavailable.', 404)
  const own = `h.readership='site' OR h.owner_id=? OR EXISTS(SELECT 1 FROM json_each(h.people) WHERE value=?) OR
    EXISTS(SELECT 1 FROM json_each(h.groups) recipient JOIN vc_publishing_groups g ON g.id=recipient.value
      JOIN vc_publishing_group_members m ON m.group_id=g.id WHERE g.retired=0 AND g.tenant_id=? AND g.site_id=? AND m.user_id=?)`
  const ancestors = selected === 'pages' ? ` AND (h.parent_id IS NULL OR EXISTS(SELECT 1 FROM "${readersView('vc_publishing_history_pages')}" p JOIN pages actual ON actual.id=p.record_id
    WHERE p.record_id=h.parent_id AND actual.created_at=h.parent_created_at AND actual.publishing_identity=h.parent_identity AND p.actor=? AND p.site=? AND p.audience='intranet' AND p.valid_structure=1 AND p.ordinary_access=1))
    AND (v.version_parent_id IS NULL OR EXISTS(SELECT 1 FROM "${readersView('vc_publishing_history_pages')}" p JOIN pages actual ON actual.id=p.record_id WHERE p.record_id=v.version_parent_id AND actual.created_at<=v.created_at AND p.actor=? AND p.site=? AND p.audience='intranet' AND p.valid_structure=1 AND p.ordinary_access=1))` : ''
  const versions = await repository.read({ site, permission: 'intranet:read-history', resource: `${selected}:${id}:private-history`, privateRecord: true, recordAccess: true },
    () => db.prepare(`SELECT v.* FROM "_${selected}_v" v JOIN vc_publishing_private_history h ON h.document_id=v.parent_id AND h.collection='${selected}' AND h.site_id=v.version_platform_site
      JOIN "${selected}" current ON current.id=v.parent_id AND current.publishing_identity=h.document_identity AND v.version_publishing_identity=h.document_identity
      WHERE v.parent_id=? AND v.version_platform_site=? AND h.tenant_id=? AND v.version_audience='intranet' AND v.id<?
      ${internal.privateRead ? '' : `AND (${own})${ancestors}`} ORDER BY v.id DESC LIMIT 6`).bind(id, site, internal.tenant, before,
        ...(internal.privateRead ? [] : [actor, actor, internal.tenant, site, actor, ...(selected === 'pages' ? [actor, site, actor, site] : [])])).all<Record<string, unknown>>())
  await repository.assertRevision(internal.tenant, internal.revision)
  return { versions: versions.results.slice(0, 5).map(version => ({ id: String(version.id), revision: Number(version.id), title: version.version_title,
    body: typeof version.version_content === 'string' ? JSON.parse(version.version_content) : null,
    layout: typeof version.version_content_layout === 'string' ? JSON.parse(version.version_content_layout) : null,
    actor: version.version_platform_write_actor, action: 'internal revision before move', createdAt: version.created_at })),
    next: versions.results.length > 5 ? Number(versions.results[4].id) : null }
}
