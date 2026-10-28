import { expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { migrateDatabase } from '../../scripts/lib/migrate-database'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { convertLegacyIntranet } from '@/publishing/legacy-conversion'
import { emptyKnowledgeBody } from '@/knowledge/content'

async function fixture() {
  const f = localD1()
  await migrateDatabase(f.db)
  f.sqlite.exec("INSERT INTO users(id,email,role) VALUES(1,'operator@example.invalid','administrator'),(2,'old-author@example.invalid','editor')")
  await bootstrapTenant(f.db, { tenant: 'default', site: 'default', administratorEmail: 'operator@example.invalid' })
  await activateTenantAuthority(f.db, 'default')
  const body = (text: string) => JSON.stringify({ root: { ...emptyKnowledgeBody.root, children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text, format: 1 }] }] } })
  const page = f.sqlite.prepare(`INSERT INTO vc_knowledge_pages(id,tenant_id,site_id,kind,parent_id,title,slug,body,visibility,published_title,published_body,revision,deleted,creator_id,updated_at)
    VALUES(?,'default','default',?,?,?, ?,?,'private',?,?,3,?,2,'2026-10-27T00:00:00.000Z')`)
  page.run('z-root', 'intranet', null, 'Newer draft', 'root', body('Draft body'), 'Published title', body('Published body'), 0)
  page.run('a-child', 'intranet', 'z-root', 'Child', 'child', body('Child body'), 'Child', body('Child body'), 0)
  page.run('deleted', 'intranet', 'z-root', 'Deleted', 'deleted', body('Deleted body'), 'Deleted', body('Deleted body'), 1)
  page.run('wiki', 'wiki', null, 'Wiki unchanged', 'wiki-unchanged', body('Wiki body'), 'Wiki unchanged', body('Wiki body'), 0)
  f.sqlite.prepare("INSERT INTO vc_knowledge_versions(id,page_id,revision,title,body,actor_id,action,created_at) VALUES('old-version','z-root',1,'Original title',?,2,'publish','2026-10-26T00:00:00.000Z')").run(body('Original history'))
  const bytes = new TextEncoder().encode('retained,file\none,two')
  f.sqlite.prepare("INSERT INTO vc_knowledge_attachments(id,page_id,object_key,filename,mime_type,size,created_at) VALUES('old-file','z-root','knowledge/original','original.csv','text/csv',?,'2026-10-26T00:00:00.000Z')").run(bytes.byteLength)
  const objects = new Map<string, Uint8Array>([['knowledge/original', bytes]])
  const storage = {
    async get(key: string) {
      const bytes = objects.get(key)
      return bytes ? { size: bytes.byteLength, async arrayBuffer() { return Uint8Array.from(bytes).buffer } } : null
    },
    async put(key: string, bytes: ArrayBuffer) { objects.set(key, new Uint8Array(bytes)) },
  } as unknown as R2Bucket
  return { ...f, objects, storage }
}

it('converts hierarchy, publications, newer drafts, protected files and attribution without changing legacy history or Wiki', async () => {
  const f = await fixture()
  try {
    const source = f.sqlite.prepare('SELECT * FROM vc_knowledge_pages ORDER BY id').all()
    const history = f.sqlite.prepare('SELECT * FROM vc_knowledge_versions ORDER BY id').all()
    const attachments = f.sqlite.prepare('SELECT * FROM vc_knowledge_attachments ORDER BY id').all()
    const result = await convertLegacyIntranet(f.db, f.storage, { actor: 1, release: 'conversion_fixture_123456789' })
    expect(result.total).toBe(3)
    const root = result.records.find(record => record.legacy === 'z-root')!
    const child = result.records.find(record => record.legacy === 'a-child')!
    expect(f.sqlite.prepare('SELECT title,_status,publishing_owner FROM pages WHERE id=?').get(root.page)).toEqual({ title: 'Published title', _status: 'published', publishing_owner: 2 })
    expect(f.sqlite.prepare('SELECT version_title,version__status FROM _pages_v WHERE parent_id=? AND latest=1').get(root.page)).toEqual({ version_title: 'Newer draft', version__status: 'draft' })
    expect(f.sqlite.prepare('SELECT parent_id FROM pages WHERE id=?').get(child.page)!.parent_id).toBe(root.page)
    expect(f.sqlite.prepare('SELECT url FROM pages_breadcrumbs WHERE _parent_id=? ORDER BY _order DESC LIMIT 1').get(child.page)!.url).toBe('/root/child')
    expect(f.sqlite.prepare("SELECT COUNT(*) n FROM vc_pub_pages_readers WHERE actor=1 AND valid_structure=1").get()!.n).toBe(2)
    expect(f.objects.get(root.files['old-file'].object!)).toEqual(f.objects.get('knowledge/original'))
    expect(root.files['old-file'].checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(f.sqlite.prepare('SELECT publishing_source_i_d,publishing_original_filename FROM media WHERE id=?').get(root.files['old-file'].media)).toEqual({ publishing_source_i_d: root.page, publishing_original_filename: 'original.csv' })
    expect(f.sqlite.prepare('SELECT * FROM vc_knowledge_pages ORDER BY id').all()).toEqual(source)
    expect(f.sqlite.prepare('SELECT * FROM vc_knowledge_versions ORDER BY id').all()).toEqual(history)
    expect(f.sqlite.prepare('SELECT * FROM vc_knowledge_attachments ORDER BY id').all()).toEqual(attachments)
    expect((await convertLegacyIntranet(f.db, f.storage, { actor: 1, release: 'conversion_fixture_123456789' })).records.every(record => record.resumed)).toBe(true)
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM pages').get()!.n).toBe(3)
    expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally { f.close() }
})

it('blocks cutover when an attachment is missing or a copied object no longer matches', async () => {
  const f = await fixture()
  try {
    const original = f.objects.get('knowledge/original')!
    f.objects.delete('knowledge/original')
    await expect(convertLegacyIntranet(f.db, f.storage, { actor: 1, release: 'conversion_fixture_123456789' })).rejects.toThrow('missing')
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM pages').get()!.n).toBe(0)
    f.objects.set('knowledge/original', original)
    const result = await convertLegacyIntranet(f.db, f.storage, { actor: 1, release: 'conversion_fixture_123456789' })
    const object = result.records.find(record => record.legacy === 'z-root')!.files['old-file'].object!
    f.objects.set(object, new Uint8Array([0]))
    await expect(convertLegacyIntranet(f.db, f.storage, { actor: 1, release: 'conversion_fixture_123456789' })).rejects.toThrow('checksum')
  } finally { f.close() }
})
