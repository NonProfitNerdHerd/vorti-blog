import { describe, expect, it } from 'vitest'
import { defaultOrganizationSeed, organizationSchema } from '../../src/organizations/schema'
import { tenantSchemaV1 } from '../../src/organizations/tenant-schema-v1'
import { TenantRepository } from '../../src/organizations/tenant-repository'
import { applicationFeatures } from '../../src/organizations/permission-catalog'
import { localD1 } from '../helpers/local-d1'

function fixture() {
  const f = localD1()
  f.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'administrator'),(2,'editor')",
  )
  for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...tenantSchemaV1])
    f.sqlite.exec(sql)
  f.sqlite
    .exec(`INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',1,1),('default',2,1);
    INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('administrator','default','Tenant Administrator','tenant-administrator');
    INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,descendants) VALUES('administrator','default',1,'administrator',1);`)
  for (const feature of applicationFeatures)
    f.sqlite
      .prepare('INSERT INTO vc_tenant_features(tenant_id,feature,available) VALUES(?,?,1)')
      .run('default', feature)
  return { ...f, admin: new TenantRepository(f.db, 1), member: new TenantRepository(f.db, 2) }
}
describe('tenant authority repository', () => {
  it('does not give Site Administrators private Wiki, sensitive forms or restricted CRM access by default', async () => {
    const f = fixture()
    try {
      f.sqlite.exec("INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('site-admin','default','Site Administrator','site-administrator'); INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('site-admin','default',2,'site-admin','default',0)")
      await expect(f.member.require('default', 'administration:settings')).resolves.toBeTruthy()
      for (const permission of ['wiki:read-private', 'forms:read-sensitive', 'crm:read-restricted-activity'] as const)
        await expect(f.member.require('default', permission)).rejects.toMatchObject({status: 403})
      await expect(f.member.read({site: 'default', permission: 'tasks:read', resource: 'private-task', privateRecord: true}, async () => 'hidden')).rejects.toMatchObject({status: 403})
      await expect(f.admin.require('default', 'wiki:read-private')).resolves.toBeTruthy()
    } finally { f.close() }
  })
  it('audits private administrator reads and rejects results when authority changes during retrieval', async () => {
    const f = fixture()
    try {
      await expect(
        f.admin.read(
          { site: 'default', permission: 'tasks:read', resource: 'task:17', privateRecord: true },
          async () => 'private content',
        ),
      ).resolves.toBe('private content')
      expect(
        f.sqlite
          .prepare(
            "SELECT action,record_id FROM vc_platform_audit WHERE action='tenant-administrator.read'",
          )
          .all(),
      ).toEqual([{ action: 'tenant-administrator.read', record_id: 'task:17' }])
      await expect(
        f.admin.read(
          { site: 'default', permission: 'tasks:read', resource: 'task:18', privateRecord: true },
          async () => {
            f.sqlite.exec("UPDATE vc_tenant_features SET available=0 WHERE feature='tasks'")
            return 'must not escape'
          },
        ),
      ).rejects.toMatchObject({ status: 409 })
    } finally {
      f.close()
    }
  })
  it('suspends only tenant membership, protects the last administrator, and keeps settings available with features disabled', async () => {
    const f = fixture()
    try {
      let snapshot = await f.admin.snapshot('default')
      await f.admin.setMemberActive({
        contextSite: 'default',
        user: 2,
        active: false,
        key: 'suspend_member_123456',
        expectedAuthorityRevision: snapshot.revision,
      })
      expect(
        f.sqlite.prepare('SELECT * FROM vc_account_status WHERE user_id=2').get(),
      ).toBeUndefined()
      snapshot = await f.admin.snapshot('default')
      await expect(
        f.admin.setMemberActive({
          contextSite: 'default',
          user: 1,
          active: false,
          key: 'suspend_admin_1234567',
          expectedAuthorityRevision: snapshot.revision,
        }),
      ).rejects.toThrow(/last active Tenant Administrator/)
      await f.admin.setFeature({
        contextSite: 'default',
        site: null,
        feature: 'tasks',
        value: false,
        key: 'disable_tasks_1234567',
        expectedAuthorityRevision: snapshot.revision,
      })
      await expect(f.admin.require('default', 'tasks:read')).rejects.toMatchObject({ status: 403 })
      await expect(f.admin.require('default', 'administration:settings')).resolves.toMatchObject({
        allowed: true,
      })
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM vc_write_guards').get()?.n).toBe(0)
    } finally {
      f.close()
    }
  })
  it('creates and assigns granular roles, retires them, and keeps immutable audit evidence', async () => {
    const f = fixture()
    try {
      let snapshot = await f.admin.snapshot('default')
      await f.admin.saveRole({
        site: 'default',
        id: 'task-author',
        key: 'create_role_123456789',
        expectedAuthorityRevision: snapshot.revision,
        name: 'Task Author',
        description: 'Create without editing existing tasks.',
        permissions: ['tasks:create'],
      })
      snapshot = await f.admin.snapshot('default')
      await f.admin.assignRole({
        contextSite: 'default',
        id: 'author-assignment',
        user: 2,
        role: 'task-author',
        site: 'default',
        descendants: false,
        key: 'assign_role_123456789',
        expectedAuthorityRevision: snapshot.revision,
      })
      await expect(f.member.require('default', 'tasks:create')).resolves.toMatchObject({
        allowed: true,
      })
      await expect(f.member.require('default', 'tasks:edit')).rejects.toMatchObject({ status: 403 })
      snapshot = await f.admin.snapshot('default')
      await f.admin.retireRole({
        site: 'default',
        id: 'task-author',
        key: 'retire_role_123456789',
        expectedAuthorityRevision: snapshot.revision,
      })
      await expect(f.member.require('default', 'tasks:create')).rejects.toMatchObject({
        status: 403,
      })
      expect(
        f.sqlite
          .prepare('SELECT action FROM vc_platform_audit ORDER BY created_at')
          .all()
          .map((row) => row.action),
      ).toEqual(['role.saved', 'role.assigned', 'role.retired'])
      expect(() => f.sqlite.exec('DELETE FROM vc_platform_audit')).toThrow(/append-only/)
    } finally {
      f.close()
    }
  })
  it('rejects stale role changes and does not grant authority through legacy global operator records', async () => {
    const f = fixture()
    try {
      const snapshot = await f.admin.snapshot('default')
      f.sqlite.exec('UPDATE vc_tenant_memberships SET active=0 WHERE user_id=2')
      await expect(
        f.admin.saveRole({
          site: 'default',
          id: 'stale',
          key: 'stale_role_123456789',
          expectedAuthorityRevision: snapshot.revision,
          name: 'Stale',
          description: '',
          permissions: ['tasks:read'],
        }),
      ).rejects.toMatchObject({ status: 409 })
      expect(
        f.sqlite.prepare("SELECT id FROM vc_tenant_roles WHERE id='stale'").get(),
      ).toBeUndefined()
      f.sqlite.exec("INSERT INTO vc_installation_operators(user_id,created_at) VALUES(2,'now')")
      await expect(f.member.require('default', 'tasks:read')).rejects.toMatchObject({ status: 403 })
      f.sqlite.exec("UPDATE vc_tenant_features SET available=0 WHERE feature='tasks'")
      await expect(
        f.admin.require('default', 'tasks:read', { privateRecord: true }),
      ).rejects.toMatchObject({ status: 403 })
      await expect(f.admin.require('default', 'administration:settings')).resolves.toMatchObject({
        allowed: true,
      })
    } finally {
      f.close()
    }
  })
})
