import { describe, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '@/organizations/schema'
import { tenantSchemaV1 } from '@/organizations/tenant-schema-v1'
import { publishingSharingSchemaV1 } from '@/publishing/sharing-schema-v1'
import { authorizeInternalRecord, readableInternalIDs } from '@/publishing/record-access'
import { publishingReadersViewSQL } from '@/publishing/readers-schema-v1'

function fixture() {
  const f = localD1()
  f.sqlite.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'administrator'),(2,'editor'),(3,'editor'); CREATE TABLE vc_knowledge_pages(id TEXT PRIMARY KEY)")
  f.sqlite.exec(`CREATE TABLE pages(id INTEGER PRIMARY KEY,parent_id INTEGER,platform_site TEXT,audience TEXT,publishing_readership TEXT,publishing_owner INTEGER,publishing_people TEXT DEFAULT '[]',publishing_groups TEXT DEFAULT '[]',_status TEXT DEFAULT 'published');
    CREATE TABLE posts(id INTEGER PRIMARY KEY,platform_site TEXT,audience TEXT,publishing_readership TEXT,publishing_owner INTEGER,publishing_people TEXT DEFAULT '[]',publishing_groups TEXT DEFAULT '[]',_status TEXT DEFAULT 'published')`)
  for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...tenantSchemaV1, ...publishingSharingSchemaV1]) f.sqlite.exec(sql)
  f.sqlite.exec('ALTER TABLE pages ADD COLUMN publishing_archived INTEGER NOT NULL DEFAULT 0')
  for (const table of ['pages', 'posts']) f.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN publishing_published_at TEXT; ALTER TABLE ${table} ADD COLUMN publishing_identity TEXT`)
  f.sqlite.exec('CREATE TABLE _pages_v(id INTEGER PRIMARY KEY,parent_id INTEGER,version__status TEXT,latest INTEGER); CREATE TABLE _posts_v(id INTEGER PRIMARY KEY,parent_id INTEGER,version__status TEXT,latest INTEGER)')
  for (const table of ['pages', 'posts']) for (const sql of publishingReadersViewSQL([table, table, `_${table}_v`])) f.sqlite.exec(sql)
  f.sqlite.exec(`INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',1,1),('default',2,1),('default',3,1);
    INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('admin','default','Administrator','tenant-administrator'),('reader','default','Reader',NULL);
    INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('reader','intranet:read');
    INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('admin','default',1,'admin',NULL,1),('reader','default',2,'reader','default',0);
    INSERT INTO vc_tenant_features(tenant_id,feature,available) VALUES('default','intranet',1);
    INSERT INTO vc_publishing_groups(id,tenant_id,site_id,name) VALUES('team','default','default','Team');
    INSERT INTO vc_publishing_group_members VALUES('team',2);
    INSERT INTO pages(id,parent_id,platform_site,audience,publishing_readership,publishing_owner,publishing_people,publishing_groups) VALUES(1,NULL,'default','intranet','site',3,'[]','[]'),
      (2,NULL,'default','intranet','restricted',3,'[]','[]'),(3,2,'default','intranet','site',3,'[]','[]'),
      (4,NULL,'default','intranet','restricted',3,'[2]','[]'),(5,NULL,'default','intranet','restricted',3,'[]','["team"]'),
      (6,7,'default','intranet','site',3,'[]','[]'),(7,NULL,'default','public','site',3,'[]','[]'),
      (9,10,'default','intranet','site',3,'[]','[]'),(10,9,'default','intranet','site',3,'[]','[]');
    INSERT INTO posts(id,platform_site,audience,publishing_readership,publishing_owner,publishing_people,publishing_groups) VALUES(1,'default','intranet','site',3,'[]','[]'),(2,'default','public','site',3,'[]','[]')`)
  return { ...f, req: (id: number) => ({ user: { id }, payload: { db: { client: f.db } }, context: {} }) as unknown as PayloadRequest }
}
describe('server-derived internal record predicates', () => {
  it('keeps a 100-record administrator read within the database query budget and audits every record', async () => {
    const f = fixture()
    try {
      const insert = f.sqlite.prepare("INSERT INTO pages(id,platform_site,audience,publishing_readership,publishing_owner) VALUES(?,'default','intranet','restricted',3)")
      for (let id = 100; id < 200; id++) insert.run(id)
      let queries = 0
      const prepare = f.db.prepare.bind(f.db)
      f.db.prepare = (sql: string) => { queries++; return prepare(sql) }
      const req = f.req(1)
      for (let id = 100; id < 200; id++) await authorizeInternalRecord(req, 'pages', 'default', id)
      expect(queries).toBeLessThan(700)
      expect(f.sqlite.prepare("SELECT COUNT(*) n FROM vc_platform_audit WHERE action='tenant-administrator.read'").get()!.n).toBe(100)
    } finally { f.close() }
  })

  it('invalidates a request-local policy snapshot after revocation and requires a fresh request', async () => {
    const f = fixture()
    try {
      const req = f.req(2)
      expect(await readableInternalIDs(req, 'pages', 'default')).toEqual([1, 4, 5])
      f.sqlite.exec("DELETE FROM vc_publishing_group_members WHERE group_id='team' AND user_id=2")
      await expect(readableInternalIDs(req, 'pages', 'default')).rejects.toMatchObject({ status: 409 })
      expect(await readableInternalIDs(f.req(2), 'pages', 'default')).toEqual([1, 4])
    } finally { f.close() }
  })
  it('resolves live reader views without a content-sized parameter list', () => {
    const f = fixture()
    try {
      const insert = f.sqlite.prepare("INSERT INTO pages(id,platform_site,audience,publishing_readership,publishing_owner) VALUES(?,'default','intranet','site',3)")
      for (let id = 100; id < 350; id++) insert.run(id)
      const query = f.sqlite.prepare('SELECT record_id FROM vc_pub_pages_readers WHERE actor=? AND site=? AND valid_structure=1 AND ordinary_access=1 AND published_tree=1 ORDER BY record_id')
      expect(query.all(2, 'default').map(row => row.record_id)).toEqual([1, 4, 5, ...Array.from({ length: 250 }, (_, index) => index + 100)])
      // The native adapter binds its numeric fields as strings. View expressions
      // need explicit affinity so these are equivalent to direct integer binds.
      expect(query.all('2', 'default')).toEqual(query.all(2, 'default'))
      expect(f.sqlite.prepare("SELECT record_id FROM vc_pub_pages_readers WHERE actor=? AND audience='public'").all('0')).toEqual([{ record_id: 7 }])
      f.sqlite.exec("DELETE FROM vc_publishing_group_members WHERE group_id='team' AND user_id=2")
      expect(query.all(2, 'default').map(row => row.record_id)).not.toContain(5)
      expect(query.all(2, 'default').map(row => row.record_id)).not.toContain(3)
    } finally { f.close() }
  })
  it('filters records and ancestor restrictions, excludes public rows, and revokes groups immediately', async () => {
    const f = fixture()
    try {
      expect(await readableInternalIDs(f.req(2), 'pages', 'default')).toEqual([1, 4, 5])
      expect(await readableInternalIDs(f.req(2), 'posts', 'default')).toEqual([1])
      f.sqlite.exec("DELETE FROM vc_publishing_group_members WHERE group_id='team' AND user_id=2")
      expect(await readableInternalIDs(f.req(2), 'pages', 'default')).toEqual([1, 4])
    } finally { f.close() }
  })
  it('audits the tenant administrator exception and retains structural boundaries', async () => {
    const f = fixture()
    try {
      expect(await readableInternalIDs(f.req(1), 'pages', 'default')).toEqual([1, 2, 3, 4, 5])
      expect(f.sqlite.prepare("SELECT COUNT(*) n FROM vc_platform_audit WHERE action='tenant-administrator.read'").get()!.n).toBe(1)
      f.sqlite.exec("UPDATE vc_tenant_features SET available=0 WHERE feature='intranet'")
      await expect(readableInternalIDs(f.req(1), 'pages', 'default')).rejects.toMatchObject({ status: 403 })
    } finally { f.close() }
  })
  it('does not expose draft ancestors through published descendants or breadcrumbs', async () => {
    const f = fixture()
    try {
      f.sqlite.exec("UPDATE pages SET _status='draft' WHERE id=1; INSERT INTO pages(id,parent_id,platform_site,audience,publishing_readership,publishing_owner) VALUES(11,1,'default','intranet','site',3)")
      expect(await readableInternalIDs(f.req(2), 'pages', 'default')).toEqual([4, 5])
      expect(await readableInternalIDs(f.req(1), 'pages', 'default')).toEqual([1, 2, 3, 4, 5, 11])
    } finally { f.close() }
  })
})
