import { APIError, createLocalReq, type CollectionSlug, type PayloadRequest } from 'payload'
import { cmsDatabase, cmsSiteContext, cmsScope } from '../organizations/cms-scope'
import { audienceTablesV1 } from './audience-schema-v1'
import { CMS_AUDIENCE, CMS_PUBLIC_RENDER, type Audience } from './readership'
import { publicDependencyInventory } from './dependencies'

const inventoryKey = Symbol.for('vorticause.server-export-record-inventory')
interface Reference { collection: string; id: number; audience: Audience | null; identity: string | null }
const inventory = (req: PayloadRequest) => ((req.context as Record<symbol, unknown>)[inventoryKey] ||= new Map()) as Map<string, Reference>
export function collectExportRecords(req: PayloadRequest, collection: string, result: unknown) {
  if (['imports', 'exports', 'search', 'event-series'].includes(collection) || !audienceTablesV1.some(([slug]) => slug === collection)) return
  const records = inventory(req), value = result as { docs?: Record<string, unknown>[]; id?: number }
  const docs = Array.isArray(value?.docs) ? value.docs : value?.id ? [value as Record<string, unknown>] : []
  const add = (reference: Reference) => {
    if (!Number.isSafeInteger(reference.id) || reference.id < 1 || !audienceTablesV1.some(([slug]) => slug === reference.collection)) return
    const key = `${reference.collection}:${reference.id}`, previous = records.get(key)
    if (previous?.identity && reference.identity && previous.identity !== reference.identity) throw new APIError('An export record changed identity. Regenerate the export.', 409)
    records.set(key, { ...reference, audience: previous?.audience || reference.audience, identity: previous?.identity || reference.identity })
    if (records.size > 10000) throw new APIError('Export fewer than 10,000 records and referenced assets per file.', 400)
  }
  for (const doc of docs) {
    add({ collection, id: Number(doc.id), audience: doc.audience === 'public' || doc.audience === 'intranet' ? doc.audience : null, identity: typeof doc.publishingIdentity === 'string' ? doc.publishingIdentity : null })
    for (const dependency of publicDependencyInventory(doc, req.payload.collections[collection as CollectionSlug].config.fields).references)
      add({ collection: dependency.collection, id: dependency.id, audience: null, identity: dependency.identity || null })
  }
}

/** No file is downloadable until its complete source manifest is ready. */
export async function saveExportManifest(req: PayloadRequest, id: number) {
  const scope = await cmsScope(req, 'read'), db = cmsDatabase(req), references = [...inventory(req).values()]
  if (!req.user || !Number.isSafeInteger(id) || id < 1) throw new APIError('Export identity unavailable.', 403)
  for (const ref of references) {
    const table = audienceTablesV1.find(([slug]) => slug === ref.collection)![1]
    const row = await db.prepare(`SELECT audience,platform_site,publishing_identity FROM "${table}" WHERE id=?`).bind(ref.id).first<{ audience: Audience; platform_site: string; publishing_identity: string }>()
    if (!row || !row.publishing_identity || row.platform_site !== scope.site || ref.audience && ref.audience !== row.audience || ref.identity && ref.identity !== row.publishing_identity) throw new APIError('An export dependency changed or is unavailable. Regenerate the export.', 409)
    ref.audience = row.audience; ref.identity = row.publishing_identity
  }
  await db.prepare('INSERT INTO vc_publishing_export_manifests(export_id,site_id,owner_id,source_count) VALUES(?,?,?,?)').bind(id, scope.site, Number(req.user.id), references.length).run()
  for (let offset = 0; offset < references.length; offset += 80) await db.batch(references.slice(offset, offset + 80).map(ref =>
    db.prepare('INSERT INTO vc_publishing_export_records(export_id,collection,record_id,audience,identity) VALUES(?,?,?,?,?)').bind(id, ref.collection, ref.id, ref.audience, ref.identity)))
  const key = crypto.randomUUID()
  await db.batch([
    db.prepare(`UPDATE vc_publishing_export_manifests SET ready=1 WHERE export_id=? AND source_count=(SELECT COUNT(*) FROM vc_publishing_export_records WHERE export_id=?)
      AND EXISTS(SELECT 1 FROM vc_organizations WHERE id=? AND authority_revision=?)`).bind(id, id, scope.organization, scope.epoch),
    db.prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())').bind(key),
    db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
  ])
}

export async function authorizeExportManifest(req: PayloadRequest, site: string, id: number) {
  const db = cmsDatabase(req), manifest = await db.prepare('SELECT source_count,ready FROM vc_publishing_export_manifests WHERE export_id=? AND site_id=?').bind(id, site).first<{ source_count: number; ready: number }>()
  if (!manifest || manifest.ready !== 1) throw new APIError('This export has no verified source manifest. Regenerate it before downloading.', 409)
  let verified = 0
  for (const [collection] of audienceTablesV1) for (const audience of ['public', 'intranet'] as const) {
    const local = await createLocalReq({ user: req.user, context: { ...cmsSiteContext(site), [CMS_AUDIENCE]: audience, ...(audience === 'public' ? { [CMS_PUBLIC_RENDER]: true } : {}) } }, req.payload)
    let after = 0
    for (;;) {
      const rows = await db.prepare('SELECT record_id,identity FROM vc_publishing_export_records WHERE export_id=? AND collection=? AND audience=? AND record_id>? ORDER BY record_id LIMIT 30').bind(id, collection, audience, after).all<{ record_id: number; identity: string }>()
      if (!rows.results.length) break
      const count = await req.payload.count({ collection: collection as CollectionSlug, req: local, overrideAccess: false, where: { and: [
        { audience: { equals: audience } }, { or: rows.results.map(row => ({ and: [{ id: { equals: row.record_id } }, { publishingIdentity: { equals: row.identity } }] })) },
      ] } })
      if (count.totalDocs !== rows.results.length) throw new APIError('Access to this export’s source records changed. Regenerate it with your current permissions.', 403)
      verified += rows.results.length; after = rows.results.at(-1)!.record_id
      if (rows.results.length < 30) break
    }
  }
  if (verified !== manifest.source_count) throw new APIError('Export source verification is incomplete.', 409)
}
