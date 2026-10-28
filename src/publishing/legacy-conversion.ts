import { appendPublishingVersion } from './native-version'
import { INTERNAL_MEDIA_PREFIX } from './storage'
import { orderLegacyIntranet, prepareLegacyPage, publishingDigest, type LegacyIntranetRow, type LegacyIntranetVersion } from './legacy-content'

interface Attachment { id: string; page_id: string; object_key: string; filename: string; mime_type: string; size: number; created_at: string; deleted: number }
interface FileMapping { media: number | null; source: string; object: string | null; checksum: string | null; filename: string; deleted: boolean }
type Value = string | number | null
const objectDigest = async (value: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), byte => byte.toString(16).padStart(2, '0')).join('')

/** Operational conversion only: invoke under the upgrade lease with writes and
 * dispatch stopped, after restore verification and the audience-safe deployment.
 * No legacy row, version or original object is changed or deleted.
 */
export async function convertLegacyIntranet(db: D1Database, storage: R2Bucket, input: { actor: number; release: string }) {
  if (!Number.isSafeInteger(input.actor) || input.actor < 1 || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.release)) throw Error('A verified release identity and administrator are required for conversion.')
  const metadata: LegacyIntranetRow[] = []
  let after = ''
  // Read bounded batches; a single legacy rich-text body may be 300 KB.
  for (;;) {
    const batch = await db.prepare("SELECT * FROM vc_knowledge_pages WHERE kind='intranet' AND id>? ORDER BY id LIMIT 10").bind(after).all<LegacyIntranetRow>()
    metadata.push(...batch.results)
    if (batch.results.length < 10) break
    after = batch.results.at(-1)!.id
  }
  const receipt: Array<{ legacy: string; page: number; sourceHash: string; files: Record<string, FileMapping>; resumed: boolean }> = []
  const insert = (table: string, row: Record<string, Value>) => {
    if (!/^[a-z_]+$/.test(table) || Object.keys(row).some(column => !/^[a-z_]+$/.test(column))) throw Error('Invalid conversion schema identifier.')
    return db.prepare(`INSERT INTO "${table}"(${Object.keys(row).map(column => `"${column}"`).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row))
  }
  const nextID = async (table: 'pages' | 'media') => {
    const row = await db.prepare(`SELECT COALESCE(MAX(id),0) id FROM "${table}"`).first<{ id: number }>()
    const sequences = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").first()
    const sequence = sequences ? await db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').bind(table).first<{ seq: number }>() : null
    const mapped = table === 'pages' ? await db.prepare('SELECT COALESCE(MAX(page_id),0) id FROM vc_publishing_legacy_map').first<{ id: number }>() : null
    return Math.max(Number(row?.id || 0), Number(sequence?.seq || 0), Number(mapped?.id || 0)) + 1
  }
  for (const legacy of orderLegacyIntranet(metadata)) {
    const [versions, attachments, authority] = await Promise.all([
      db.prepare('SELECT * FROM vc_knowledge_versions WHERE page_id=? ORDER BY revision').bind(legacy.id).all<LegacyIntranetVersion>(),
      db.prepare('SELECT * FROM vc_knowledge_attachments WHERE page_id=? ORDER BY id').bind(legacy.id).all<Attachment>(),
      db.prepare(`SELECT o.authority_revision FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id
        WHERE s.id=? AND s.organization_id=? AND EXISTS(SELECT 1 FROM vc_active_tenant_administrators a WHERE a.tenant_id=o.id AND a.user_id=?)
        AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry n JOIN vc_sites p ON p.id=n.ancestor_id WHERE n.descendant_id=s.id AND p.archived=1)`)
        .bind(legacy.site_id, legacy.tenant_id, input.actor).first<{ authority_revision: number }>(),
    ])
    if (!authority) throw Error(`Legacy conversion is not authorized for site ${legacy.site_id}; release remains blocked.`)
    if (attachments.results.length > 500) throw Error('Legacy attachment batch exceeds the validated conversion limit; release remains blocked.')
    const plan = await prepareLegacyPage(legacy, versions.results)
    const sourceHash = await publishingDigest({ source: plan.sourceHash, attachments: attachments.results })
    const existing = await db.prepare('SELECT page_id,content_hash,attachment_map FROM vc_publishing_legacy_map WHERE legacy_id=?').bind(legacy.id).first<{ page_id: number; content_hash: string; attachment_map: string }>()
    if (existing) {
      const page = await db.prepare("SELECT 1 FROM pages WHERE id=? AND platform_site=? AND publishing_lineage=?").bind(existing.page_id, legacy.site_id, `legacy:${legacy.id}`).first()
      if (existing.content_hash !== sourceHash || !page) throw Error('A completed legacy mapping no longer matches its source; release remains blocked.')
      const files = JSON.parse(existing.attachment_map) as Record<string, FileMapping>
      for (const file of Object.values(files)) if (!file.deleted) {
        const object = file.object ? await storage.get(file.object) : null
        if (!object || await objectDigest(await object.arrayBuffer()) !== file.checksum) throw Error('A migrated attachment failed its resumed checksum verification.')
      }
      receipt.push({ legacy: legacy.id, page: existing.page_id, sourceHash, files, resumed: true })
      continue
    }
    const id = await nextID('pages'), key = `legacy:${legacy.id}`, now = new Date().toISOString()
    const parent = legacy.parent_id ? await db.prepare('SELECT page_id FROM vc_publishing_legacy_map WHERE legacy_id=?').bind(legacy.parent_id).first<{ page_id: number }>() : null
    if (legacy.parent_id && !parent) throw Error('The parent conversion has not completed.')
    const collision = await db.prepare("SELECT id FROM pages WHERE platform_site=? AND audience='intranet' AND slug=?").bind(legacy.site_id, legacy.slug).first()
    if (collision) throw Error('A legacy slug conflicts with an existing internal Page; release remains blocked.')
    const epoch = Number(authority.authority_revision), operationKey = await publishingDigest({ release: input.release, legacy: legacy.id })
    const statements: D1PreparedStatement[] = [
      db.prepare(`INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_knowledge_pages p JOIN vc_organizations o ON o.id=p.tenant_id
        WHERE p.id=? AND p.revision=? AND p.updated_at=? AND o.authority_revision=?`).bind(operationKey, legacy.id, legacy.revision, legacy.updated_at, epoch),
      db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(operationKey),
      insert('pages', { id, parent_id: parent?.page_id ?? null, title: plan.title, slug: legacy.slug, content: JSON.stringify(plan.content),
        platform_site: legacy.site_id, platform_write_actor: input.actor, platform_write_epoch: epoch, audience: 'intranet',
        publishing_owner: plan.owner, publishing_readership: 'site', publishing_people: '[]', publishing_groups: '[]', publishing_archived: Number(plan.archived),
        publishing_lineage: key, publishing_identity: key, publishing_operation_key: key, _status: plan.status, publishing_published_at: plan.status === 'published' ? now : null,
        created_at: versions.results[0]?.created_at || legacy.updated_at, updated_at: legacy.updated_at,
        published_at: plan.status === 'published' ? versions.results.find(version => ['publish', 'published'].includes(version.action))?.created_at || legacy.updated_at : null }),
    ]
    const breadcrumbs = parent ? (await db.prepare('SELECT doc_id,url,label FROM pages_breadcrumbs WHERE _parent_id=? ORDER BY _order').bind(parent.page_id).all<{ doc_id: number; url: string; label: string }>()).results : []
    breadcrumbs.push({ doc_id: id, url: `${breadcrumbs.at(-1)?.url || ''}/${encodeURIComponent(legacy.slug)}`, label: plan.title })
    for (const [index, crumb] of breadcrumbs.entries()) statements.push(insert('pages_breadcrumbs', { id: `${key}:${index}`, _order: index + 1, _parent_id: id, ...crumb }))
    statements.push(...await appendPublishingVersion(db, { collection: 'pages', id, key: `${key}:base`, now: legacy.updated_at, actor: input.actor, epoch }))
    if (plan.hasUnpublishedChanges) statements.push(...await appendPublishingVersion(db, { collection: 'pages', id, key: `${key}:draft`, now: legacy.updated_at, actor: input.actor, epoch,
      document: { title: plan.draftTitle, content: plan.draftContent, status: 'draft' } }))
    const files: Record<string, FileMapping> = {}
    let mediaID = await nextID('media')
    for (const attachment of attachments.results) {
      if (attachment.deleted) { files[attachment.id] = { media: null, source: attachment.object_key, object: null, checksum: null, filename: attachment.filename, deleted: true }; continue }
      if (attachment.size < 1 || attachment.size > 10 * 1024 * 1024 || /[\\/\u0000-\u001f]/.test(attachment.filename) || !/^[a-zA-Z0-9_-]{1,80}$/.test(attachment.id)) throw Error('Unsupported legacy attachment; release remains blocked.')
      const original = await storage.get(attachment.object_key)
      if (!original || original.size !== attachment.size) throw Error('Legacy attachment is missing or has an unexpected size; release remains blocked.')
      const bytes = await original.arrayBuffer(), checksum = await objectDigest(bytes)
      const prefix = `${INTERNAL_MEDIA_PREFIX}legacy/${legacy.id}/${attachment.id}`, filename = `legacy-${attachment.id}-${attachment.filename}`, object = `${prefix}/${filename}`
      const previous = await storage.get(object)
      if (previous) {
        if (previous.size !== bytes.byteLength || await objectDigest(await previous.arrayBuffer()) !== checksum) throw Error('A staged legacy attachment has different bytes; release remains blocked.')
      } else await storage.put(object, bytes, { httpMetadata: { contentType: attachment.mime_type } })
      const verified = await storage.get(object)
      if (!verified || await objectDigest(await verified.arrayBuffer()) !== checksum) throw Error('Legacy attachment copy failed checksum verification.')
      statements.push(insert('media', { id: mediaID, alt: attachment.filename, filename, mime_type: attachment.mime_type, filesize: attachment.size, prefix,
        platform_site: legacy.site_id, platform_write_actor: input.actor, platform_write_epoch: epoch, audience: 'intranet', publishing_owner: plan.owner,
        publishing_readership: 'site', publishing_people: '[]', publishing_groups: '[]', publishing_lineage: `legacy-file:${attachment.id}`, publishing_operation_key: `legacy-file:${attachment.id}`,
        publishing_identity: `legacy-file:${attachment.id}`, publishing_source_collection: 'pages', publishing_source_i_d: id, publishing_source_identity: key,
        publishing_original_filename: attachment.filename, created_at: attachment.created_at, updated_at: attachment.created_at }))
      files[attachment.id] = { media: mediaID++, source: attachment.object_key, object, checksum, filename: attachment.filename, deleted: false }
    }
    statements.push(insert('vc_publishing_legacy_map', { legacy_id: legacy.id, page_id: id, legacy_revision: legacy.revision, content_hash: sourceHash, attachment_map: JSON.stringify(files), converted_at: now }),
      insert('vc_platform_audit', { id: crypto.randomUUID(), organization_id: legacy.tenant_id, site_id: legacy.site_id, actor_id: input.actor, action: 'publishing.legacy-converted',
        record_type: 'pages', record_id: String(id), after_value: JSON.stringify({ legacy: legacy.id, release: input.release, sourceHash }), operation_key: operationKey, created_at: now }))
    await db.batch(statements)
    receipt.push({ legacy: legacy.id, page: id, sourceHash, files, resumed: false })
  }
  if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length) throw Error('Foreign-key validation failed after legacy conversion.')
  return { status: 'passed', total: receipt.length, records: receipt }
}
