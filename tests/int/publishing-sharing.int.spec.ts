import { expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '@/organizations/schema'
import { tenantSchemaV1 } from '@/organizations/tenant-schema-v1'
import { publishingSharingSchemaV1 } from '@/publishing/sharing-schema-v1'
import { PublishingSharing } from '@/publishing/sharing'
import { readableInternalIDs } from '@/publishing/record-access'
import { publishingReadersViewSQL } from '@/publishing/readers-schema-v1'

function fixture() {
  const f = localD1()
  f.sqlite.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'administrator'),(2,'editor'),(3,'editor'),(4,'editor');
    CREATE TABLE vc_knowledge_pages(id TEXT PRIMARY KEY);
    CREATE TABLE pages(id INTEGER PRIMARY KEY,parent_id INTEGER,title TEXT,content TEXT,platform_site TEXT,audience TEXT,publishing_readership TEXT,publishing_owner INTEGER,publishing_people TEXT,publishing_groups TEXT,publishing_operation_key TEXT,platform_write_actor INTEGER,platform_write_epoch INTEGER,updated_at TEXT,_status TEXT);
    CREATE TABLE _pages_v(id INTEGER PRIMARY KEY,parent_id INTEGER,version_title TEXT,version_content TEXT,version_platform_site TEXT,version_audience TEXT,version_publishing_readership TEXT,version_publishing_owner INTEGER,version_publishing_people TEXT,version_publishing_groups TEXT,version_publishing_operation_key TEXT,version_platform_write_actor INTEGER,version_platform_write_epoch INTEGER,version_updated_at TEXT,version__status TEXT,created_at TEXT,updated_at TEXT,latest INTEGER);
    CREATE TABLE pages_breadcrumbs(id TEXT PRIMARY KEY,_order INTEGER,_parent_id INTEGER,doc_id INTEGER,url TEXT,label TEXT);
    CREATE TABLE _pages_v_version_breadcrumbs(id INTEGER PRIMARY KEY,_order INTEGER,_parent_id INTEGER,doc_id INTEGER,url TEXT,label TEXT,_uuid TEXT);`)
  for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...tenantSchemaV1, ...publishingSharingSchemaV1]) f.sqlite.exec(sql)
  f.sqlite.exec('ALTER TABLE pages ADD COLUMN publishing_archived INTEGER NOT NULL DEFAULT 0')
  for (const sql of publishingReadersViewSQL(['pages', 'pages', '_pages_v'])) f.sqlite.exec(sql)
  f.sqlite.exec(`INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',1,1),('default',2,1),('default',3,1);
    INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('admin','default','Administrator','tenant-administrator'),('editor','default','Site Administrator','site-administrator'),('reader','default','Reader',NULL);
    INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('reader','intranet:read');
    INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('admin','default',1,'admin',NULL,1),('editor','default',2,'editor','default',0),('reader','default',3,'reader','default',0);
    INSERT INTO vc_tenant_features(tenant_id,feature,available) VALUES('default','intranet',1);
    INSERT INTO pages VALUES(1,NULL,'Published','published-body','default','intranet','site',2,'[]','[]',NULL,2,1,'2026-10-27T00:00:00.000Z','published',0);
    INSERT INTO _pages_v VALUES(1,1,'Draft','preserved-draft-body','default','intranet','site',2,'[]','[]',NULL,2,1,'2026-10-27T01:00:00.000Z','draft','2026-10-27T01:00:00.000Z','2026-10-27T01:00:00.000Z',1);
    INSERT INTO pages_breadcrumbs VALUES('base',1,1,1,'/home','Published');
    INSERT INTO _pages_v_version_breadcrumbs VALUES(1,1,1,1,'/home','Draft','draft-uuid');`)
  f.sqlite.exec("ALTER TABLE pages ADD COLUMN publishing_published_at TEXT; ALTER TABLE pages ADD COLUMN publishing_identity TEXT; UPDATE pages SET publishing_identity='fixture-page-1'")
  const req = (id: number) => ({ user: { id }, payload: { db: { client: f.db } }, context: {} }) as unknown as PayloadRequest
  return { ...f, req, sharing: new PublishingSharing(req(2)) }
}

it('atomically changes readership, revokes readers, preserves the latest draft and native history, and replays once', async () => {
  const f = fixture()
  try {
    const current = await f.sharing.read('default', 'pages', 1)
    expect(await readableInternalIDs(f.req(3), 'pages', 'default')).toEqual([1])
    const input = { site: 'default', collection: 'pages', id: 1, readership: 'restricted' as const, people: [] as number[], groups: [] as string[], expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: 'restrict_page_123456789' }
    await f.sharing.save(input)
    const epoch = Number(f.sqlite.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").get()!.authority_revision)
    await f.sharing.save(input)
    expect(f.sqlite.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").get()!.authority_revision).toBe(epoch)
    expect(await readableInternalIDs(f.req(3), 'pages', 'default')).toEqual([])
    expect(await readableInternalIDs(f.req(2), 'pages', 'default')).toEqual([1])
    expect(f.sqlite.prepare('SELECT content,publishing_readership FROM pages WHERE id=1').get()).toEqual({ content: 'published-body', publishing_readership: 'restricted' })
    expect(f.sqlite.prepare('SELECT version_content,version_publishing_readership FROM _pages_v WHERE latest=1').get()).toEqual({ version_content: 'preserved-draft-body', version_publishing_readership: 'restricted' })
    expect(f.sqlite.prepare('SELECT version_content,version_publishing_readership,latest FROM _pages_v WHERE id=1').get()).toEqual({ version_content: 'preserved-draft-body', version_publishing_readership: 'site', latest: 0 })
    expect(f.sqlite.prepare('SELECT label,_uuid FROM _pages_v_version_breadcrumbs WHERE _parent_id=(SELECT id FROM _pages_v WHERE latest=1)').get()).toEqual({ label: 'Draft', _uuid: 'draft-uuid' })
    expect(f.sqlite.prepare("SELECT COUNT(*) n FROM vc_platform_audit WHERE action='publishing.share'").get()!.n).toBe(1)
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM vc_write_guards').get()!.n).toBe(0)
  } finally { f.close() }
})

it('rejects stale draft revisions and rolls back invalid cross-tenant recipients without changing content or authority', async () => {
  const f = fixture()
  try {
    const current = await f.sharing.read('default', 'pages', 1)
    const input = { site: 'default', collection: 'pages', id: 1, readership: 'restricted' as const, people: [4], groups: [] as string[], expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: 'invalid_reader_12345678' }
    await expect(f.sharing.save(input)).rejects.toMatchObject({ status: 409 })
    expect(f.sqlite.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").get()!.authority_revision).toBe(current.authorityRevision)
    expect(f.sqlite.prepare('SELECT publishing_readership FROM pages WHERE id=1').get()!.publishing_readership).toBe('site')
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM _pages_v').get()!.n).toBe(1)
    f.sqlite.exec("UPDATE _pages_v SET updated_at='2026-10-27T02:00:00.000Z' WHERE id=1")
    await expect(f.sharing.save({ ...input, people: [3], key: 'stale_draft_123456789' })).rejects.toMatchObject({ status: 409 })
    expect(f.sqlite.prepare('SELECT COUNT(*) n FROM vc_platform_operations').get()!.n).toBe(0)
  } finally { f.close() }
})
