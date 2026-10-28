import { APIError, type PayloadRequest } from 'payload'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { TenantRepository } from '../organizations/tenant-repository'
import { CMS_AUDIENCE } from './readership'
import { emptyKnowledgeBody } from '../knowledge/content'
import { internalPagePath } from './paths'
import { readersView } from './readers-schema-v1'

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }
interface Mapping { legacy_id: string; page_id: number; attachment_map: string }

export async function retiredIntranetWrite(req: PayloadRequest, site: string) {
  if (!req.user) throw new APIError('Sign in to edit Intranet content.', 401)
  const repository = new TenantRepository(cmsDatabase(req), Number(req.user.id))
  let author = false
  for (const permission of ['intranet:create', 'intranet:edit', 'intranet:delete', 'intranet:publish'] as const) {
    try { await repository.require(site, permission); author = true; break }
    catch (error) { if (Number((error as { status?: number }).status) !== 403) throw error }
  }
  if (!author) throw new APIError('You cannot edit Intranet content.', 403)
  return Response.json({ message: 'Intranet publishing has moved to the shared Pages editor. Reload the document in Intranet → Pages before saving.',
    collection: 'pages', editor: `/admin/collections/pages?site=${encodeURIComponent(site)}&audience=intranet` }, { status: 409, headers })
}

/** Compatibility reads always authorize the migrated document's current state.
 * They never fall back to the old site's broader readership after migration.
 */
export async function readLegacyIntranet(req: PayloadRequest, site: string, storage: R2Bucket) {
  if (!req.user) throw new APIError('Sign in to read Intranet content.', 401)
  const db = cmsDatabase(req), authority = new TenantRepository(db, Number(req.user.id)), url = new URL(req.url!)
  const permitted = await authority.require(site, 'intranet:read')
  const history = url.searchParams.get('draft') === '1' || url.searchParams.has('versions')
  if (history) await authority.require(site, 'intranet:read-history')
  const id = url.searchParams.get('id') || ''
  const local = { ...req, context: { ...cmsSiteContext(site), [CMS_AUDIENCE]: 'intranet' } }
  const mapped = async (legacy: string) => {
    const mapping = await db.prepare(`SELECT m.* FROM vc_publishing_legacy_map m JOIN vc_knowledge_pages k ON k.id=m.legacy_id
      WHERE m.legacy_id=? AND k.site_id=? AND k.kind='intranet'`).bind(legacy, site).first<Mapping>()
    if (!mapping) throw new APIError('Content unavailable.', 404)
    const actual = await db.prepare('SELECT audience,publishing_lineage FROM pages WHERE id=? AND platform_site=?').bind(mapping.page_id, site).first<{ audience: string; publishing_lineage: string }>()
    if (!actual || actual.publishing_lineage !== `legacy:${legacy}`) throw new APIError('Content unavailable.', 404)
    // File requests authorize the retained private media itself. A later move
    // of its source Page does not make the attachment public or erase access.
    if (url.searchParams.has('file')) return { page: null, mapping }
    const moved = actual.audience === 'public'
    if (moved) {
      if (!history) throw new APIError('This document has moved. Open it in the shared Pages interface.', 409)
      await authority.require(site, 'pages:read-history')
      await authority.read({ site, permission: 'intranet:read-history', resource: `pages:${mapping.page_id}:legacy-history`, privateRecord: true, recordAccess: true }, async () => {
        const row = await db.prepare(`SELECT ordinary_access,valid_structure FROM "${readersView('vc_publishing_history_pages')}" WHERE record_id=? AND actor=? AND site=?`).bind(mapping.page_id, Number(req.user!.id), site).first<{ ordinary_access: number; valid_structure: number }>()
        if (!row || !row.valid_structure || !permitted.privateRead && !row.ordinary_access) throw new APIError('History unavailable.', 403)
      })
    }
    const page = await req.payload.findByID({ collection: 'pages', id: mapping.page_id, req: { ...local, context: { ...local.context, [CMS_AUDIENCE]: moved ? 'public' : 'intranet' } }, depth: 0, draft: history, overrideAccess: false })
    if (page.audience !== actual.audience || page.publishingLineage !== `legacy:${legacy}`) throw new APIError('Content unavailable.', 404)
    return { page, mapping }
  }
  let result: unknown
  if (id) {
    const { page, mapping } = await mapped(id)
    if (url.searchParams.has('file')) {
      const files = JSON.parse(mapping.attachment_map) as Record<string, { media: number | null; object: string | null; filename: string; deleted: boolean }>
      const file = files[url.searchParams.get('file')!]
      if (!file || file.deleted || !file.media || !file.object) throw new APIError('File unavailable.', 404)
      const media = await req.payload.findByID({ collection: 'media', id: file.media, req: local, depth: 0, overrideAccess: false })
      if (media.audience !== 'intranet' || media.publishingLineage !== `legacy-file:${url.searchParams.get('file')}`) throw new APIError('File unavailable.', 404)
      const object = await storage.get(file.object)
      if (!object) throw new APIError('File unavailable.', 404)
      try { await authority.assertRevision(permitted.tenant, permitted.revision) }
      catch (error) { await object.body.cancel(); throw error }
      return new Response(object.body, { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` } })
    }
    if (url.searchParams.has('versions')) {
      if (!page) throw new APIError('History unavailable.', 404)
      const before = Number(url.searchParams.get('beforeRevision') || Number.MAX_SAFE_INTEGER)
      if (!Number.isSafeInteger(before) || before < 1) throw new APIError('Choose a valid history cursor.', 400)
      const versions = await db.prepare('SELECT id,revision,title,body,actor_id AS actor,action,created_at AS createdAt FROM vc_knowledge_versions WHERE page_id=? AND revision<? ORDER BY revision DESC LIMIT 6').bind(id, before).all<{ body: string; revision: number } & Record<string, unknown>>()
      result = { versions: versions.results.slice(0, 5).map(version => ({ ...version, body: JSON.parse(version.body) })), next: versions.results.length > 5 ? versions.results[4].revision : null,
        unified: { collection: 'pages', id: page.id } }
    } else {
      if (!page) throw new APIError('Content unavailable.', 404)
      const files = JSON.parse(mapping.attachment_map) as Record<string, { media: number | null; filename: string; deleted: boolean }>
      const attachments: Array<{ id: string; filename: string; media: number }> = []
      const afterFile = url.searchParams.get('afterFile') || ''
      const candidates = Object.entries(files).filter(([key, file]) => key > afterFile && !file.deleted && file.media).sort(([a], [b]) => a.localeCompare(b))
      let inspected = 0
      // Bound each response, but apply current media authorization before returning
      // even a filename. A retained migration map is lineage, never access authority.
      for (const [key, file] of candidates.slice(0, 20)) {
        inspected++
        try {
          const media = await req.payload.findByID({ collection: 'media', id: file.media!, req: local, depth: 0, overrideAccess: false })
          if (media.audience === 'intranet' && media.publishingLineage === `legacy-file:${key}`)
            attachments.push({ id: key, filename: file.filename, media: media.id })
        } catch (error) {
          if (![403, 404].includes(Number((error as { status?: number }).status))) throw error
        }
      }
      result = { doc: { id, title: page.title, slug: page.slug, body: page.content || emptyKnowledgeBody, visibility: 'private', published: page._status === 'published',
        attachments, nextAttachment: candidates.length > inspected ? candidates[inspected - 1]?.[0] || null : null,
        unified: { collection: 'pages', id: page.id, path: `/intranet/pages${internalPagePath(page)}` } } }
    }
  } else {
    const after = url.searchParams.get('after') || '', search = (url.searchParams.get('search') || '').slice(0, 200)
    const pages = await req.payload.find({ collection: 'pages', req: local, depth: 0, draft: history, overrideAccess: false, limit: 20,
      sort: 'publishingLineage', select: { title: true, slug: true, publishingLineage: true, _status: true },
      where: { and: [{ publishingLineage: { like: 'legacy:' } }, { publishingLineage: { greater_than: `legacy:${after}` } }, ...(search ? [{ title: { like: search } }] : [])] } })
    const docs = []
    for (const page of pages.docs) {
      const legacy = page.publishingLineage?.slice(7)
      if (!legacy) continue
      const map = await db.prepare('SELECT 1 FROM vc_publishing_legacy_map WHERE legacy_id=? AND page_id=?').bind(legacy, page.id).first()
      if (map) docs.push({ id: legacy, title: page.title, slug: page.slug, visibility: 'private', published: page._status === 'published', unified: { collection: 'pages', id: page.id } })
    }
    result = { docs, next: pages.hasNextPage ? pages.docs.at(-1)?.publishingLineage?.slice(7) || null : null }
  }
  await authority.assertRevision(permitted.tenant, permitted.revision)
  return Response.json(result, { headers })
}
