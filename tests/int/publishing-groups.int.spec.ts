import { describe, expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '@/organizations/schema'
import { tenantSchemaV1 } from '@/organizations/tenant-schema-v1'
import { TenantRepository } from '@/organizations/tenant-repository'
import { PublishingGroups } from '@/publishing/groups'
import { publishingSharingSchemaV1 } from '@/publishing/sharing-schema-v1'

function fixture() {
  const f = localD1()
  f.sqlite.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'administrator'),(2,'editor'),(3,'editor'); CREATE TABLE pages(id INTEGER PRIMARY KEY); CREATE TABLE vc_knowledge_pages(id TEXT PRIMARY KEY)")
  for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...tenantSchemaV1, ...publishingSharingSchemaV1]) f.sqlite.exec(sql)
  f.sqlite.exec(`INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',1,1),('default',2,1),('default',3,1);
    INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('admin','default','Administrator','tenant-administrator'),('site-admin','default','Site Administrator','site-administrator'),('reader','default','Reader',NULL);
    INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('reader','intranet:read');
    INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('admin','default',1,'admin',NULL,1),('site-admin','default',2,'site-admin','default',0),('reader','default',3,'reader','default',0);`)
  return { ...f, admin: new PublishingGroups(f.db, 1), siteAdmin: new PublishingGroups(f.db, 2), member: new PublishingGroups(f.db, 3), authority: new TenantRepository(f.db, 1) }
}

describe('dedicated internal sharing groups', () => {
  it('supports scoped administrators, idempotent changes, immediate revocation, audit and retirement', async () => {
    const f = fixture()
    try {
      const initial = await f.authority.snapshot('default')
      const input = { site: 'default', id: 'team', name: 'Team', retired: false, members: [3], expectedAuthorityRevision: initial.revision, key: 'create_group_12345678' }
      await f.siteAdmin.save(input)
      await f.siteAdmin.save(input)
      let result = await f.admin.list('default')
      expect(result.groups[0].members).toEqual([3])
      expect(result.authorityRevision).toBeGreaterThan(initial.revision)
      await expect(f.member.list('default')).rejects.toMatchObject({ status: 403 })
      await expect(f.admin.save({ ...input, key: 'stale_group_12345678', members: [] })).rejects.toMatchObject({ status: 409 })
      await f.admin.save({ ...input, key: 'revoke_group_12345678', members: [], expectedAuthorityRevision: result.authorityRevision })
      result = await f.admin.list('default')
      expect(result.groups[0].members).toEqual([])
      await f.admin.save({ ...input, key: 'retire_group_12345678', retired: true, expectedAuthorityRevision: result.authorityRevision })
      expect((await f.admin.list('default')).groups[0].retired).toBe(1)
      expect(f.sqlite.prepare("SELECT COUNT(*) n FROM vc_platform_audit WHERE record_type='publishing-group'").get()!.n).toBe(3)
      expect(f.sqlite.prepare('SELECT COUNT(*) n FROM vc_write_guards').get()!.n).toBe(0)
    } finally { f.close() }
  })
  it('rolls back the entire mutation for an inactive recipient and prevents group scope changes', async () => {
    const f = fixture()
    try {
      f.sqlite.exec("UPDATE vc_tenant_memberships SET active=0 WHERE user_id=3")
      const snapshot = await f.authority.snapshot('default')
      await expect(f.admin.save({ site: 'default', id: 'team', name: 'Team', retired: false, members: [3], expectedAuthorityRevision: snapshot.revision, key: 'invalid_group_12345678' })).rejects.toThrow('Sharing recipient unavailable')
      expect((await f.admin.list('default')).groups).toEqual([])
      expect((await f.authority.snapshot('default')).revision).toBe(snapshot.revision)
      await f.admin.save({ site: 'default', id: 'team', name: 'Team', retired: false, members: [2], expectedAuthorityRevision: snapshot.revision, key: 'valid_group_12345678' })
      expect(() => f.sqlite.exec("UPDATE vc_publishing_groups SET site_id='other' WHERE id='team'")).toThrow('scope is immutable')
    } finally { f.close() }
  })
  it('retains explicit administrative restrictions for built-in administrators', async () => {
    const f = fixture()
    try {
      f.sqlite.exec("INSERT INTO vc_tenant_restrictions(tenant_id,user_id,permission) VALUES('default',1,'administration:assignments')")
      await expect(f.admin.list('default')).rejects.toMatchObject({ status: 403 })
    } finally { f.close() }
  })
})
