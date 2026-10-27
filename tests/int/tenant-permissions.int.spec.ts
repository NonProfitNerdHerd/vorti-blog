import { describe, expect, it } from 'vitest'
import { permissions } from '../../src/organizations/permission-catalog'
import {
  effectiveFeature,
  canDelegate,
  evaluateTenantPermission,
  type FeaturePolicy,
  type TenantPolicy,
} from '../../src/organizations/tenant-policy'
import { tenantSchemaV1 } from '../../src/organizations/tenant-schema-v1'
import { localD1 } from '../helpers/local-d1'

const sites = [
  { id: 'root', organization: 'one', parent: null, archived: false },
  { id: 'child', organization: 'one', parent: 'root', archived: false },
  { id: 'other', organization: 'two', parent: null, archived: false },
]
function policy(): TenantPolicy {
  return {
    tenant: 'one',
    accountActive: true,
    membershipActive: true,
    sites,
    roles: [
      {
        id: 'admin',
        tenant: 'one',
        builtin: 'tenant-administrator',
        retired: false,
        permissions: [...permissions],
      },
    ],
    assignments: [{ role: 'admin', site: null, descendants: true }],
    denied: [],
  }
}
describe('tenant permissions', () => {
  it('does not delegate a local grant to future descendants or another site', () => {
    const p = policy()
    p.roles[0].builtin = null
    p.roles[0].permissions = ['tasks:create', 'administration:assignments']
    p.assignments[0] = { role: 'admin', site: 'root', descendants: false }
    expect(
      canDelegate(p, { site: 'root', descendants: false, permissions: ['tasks:create'] }),
    ).toBe(true)
    expect(canDelegate(p, { site: 'root', descendants: true, permissions: ['tasks:create'] })).toBe(
      false,
    )
    expect(
      canDelegate(p, { site: 'child', descendants: false, permissions: ['tasks:create'] }),
    ).toBe(false)
    expect(canDelegate(p, { site: null, descendants: true, permissions: ['tasks:create'] })).toBe(
      false,
    )
    p.assignments[0].descendants = true
    expect(
      canDelegate(p, { site: 'child', descendants: true, permissions: ['tasks:create'] }),
    ).toBe(true)
    p.denied = ['tasks:create']
    expect(
      canDelegate(p, { site: 'child', descendants: true, permissions: ['tasks:create'] }),
    ).toBe(false)
  })
  it('audits the built-in private read exception without bypassing tenant, account or feature boundaries', () => {
    const input = {
      site: 'child',
      permission: 'tasks:read' as const,
      featureAvailable: true,
      privateRecord: true,
    }
    expect(evaluateTenantPermission(policy(), input)).toMatchObject({
      allowed: true,
      privateRead: true,
      auditAdministratorRead: true,
    })
    expect(evaluateTenantPermission(policy(), { ...input, site: 'other' }).allowed).toBe(false)
    expect(evaluateTenantPermission(policy(), { ...input, featureAvailable: false }).allowed).toBe(
      false,
    )
    expect(evaluateTenantPermission({ ...policy(), accountActive: false }, input).allowed).toBe(
      false,
    )
    expect(evaluateTenantPermission({ ...policy(), membershipActive: false }, input).allowed).toBe(
      false,
    )
    const copy = policy()
    copy.roles[0].builtin = null
    expect(evaluateTenantPermission(copy, input).allowed).toBe(false)
    expect(evaluateTenantPermission(copy, { ...input, recordAccess: true })).toMatchObject({
      allowed: true,
      privateRead: false,
      auditAdministratorRead: false,
    })
  })
  it('combines ordinary grants, retains restrictions and removes retired grants immediately', () => {
    const p = policy()
    p.roles[0].builtin = null
    p.roles[0].permissions = ['tasks:create']
    p.roles.push({
      id: 'editor',
      tenant: 'one',
      builtin: null,
      retired: false,
      permissions: ['tasks:edit'],
    })
    p.assignments.push({ role: 'editor', site: 'root', descendants: true })
    const input = { site: 'child', permission: 'tasks:edit' as const, featureAvailable: true }
    expect(evaluateTenantPermission(p, input).allowed).toBe(true)
    p.denied.push('tasks:edit')
    expect(evaluateTenantPermission(p, input).reason).toBe('restricted')
    p.denied = []
    p.roles[1].retired = true
    expect(evaluateTenantPermission(p, input).allowed).toBe(false)
    expect(evaluateTenantPermission(p, { ...input, permission: 'tasks:create' }).allowed).toBe(true)
  })
  it('requires explicit descendant scope and rejects malformed administrator assignments', () => {
    const p = policy()
    p.roles[0].builtin = 'site-administrator'
    p.assignments[0].site = 'root'
    p.assignments[0].descendants = false
    const input = { site: 'child', permission: 'tasks:read' as const, featureAvailable: true }
    expect(evaluateTenantPermission(p, input).allowed).toBe(false)
    p.assignments[0].descendants = true
    expect(evaluateTenantPermission(p, input).allowed).toBe(true)
    expect(evaluateTenantPermission(p, { ...input, privateRecord: true }).allowed).toBe(false)
    p.roles[0].builtin = 'tenant-administrator'
    expect(evaluateTenantPermission(p, input).reason).toBe('invalid-policy')
  })
  it('keeps tenant availability as a ceiling while resolving site inheritance', () => {
    const p: FeaturePolicy = {
      tenant: 'one',
      sites,
      available: {
        pages: true,
        posts: true,
        tasks: true,
        crm: true,
        forms: true,
        workflows: true,
        wiki: true,
        intranet: true,
      },
      overrides: [{ site: 'root', feature: 'tasks', value: 'disabled' }],
    }
    expect(effectiveFeature(p, 'child', 'tasks')).toMatchObject({
      available: false,
      controllingScope: 'root',
      configured: 'inherit',
    })
    p.overrides.push({ site: 'child', feature: 'tasks', value: 'enabled' })
    expect(effectiveFeature(p, 'child', 'tasks').available).toBe(true)
    p.available.tasks = false
    expect(effectiveFeature(p, 'child', 'tasks')).toMatchObject({
      available: false,
      controllingScope: 'one',
      locked: true,
    })
    expect(() => effectiveFeature(p, 'other', 'tasks')).toThrow()
  })
})

function database() {
  const fixture = localD1()
  fixture.sqlite.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE vc_organizations(id TEXT PRIMARY KEY,authority_revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE vc_sites(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,UNIQUE(id,organization_id));
    CREATE TABLE vc_account_status(user_id INTEGER PRIMARY KEY REFERENCES users(id),disabled INTEGER NOT NULL);
    INSERT INTO users VALUES(1),(2); INSERT INTO vc_organizations(id) VALUES('one'),('two');
    INSERT INTO vc_sites VALUES('root','one'),('other','two');`)
  for (const sql of tenantSchemaV1) fixture.sqlite.exec(sql)
  fixture.sqlite
    .exec(`INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('one',1,1),('one',2,1);
    INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('admin','one','Tenant Administrator','tenant-administrator');
    INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('first','one',1,'admin',NULL,1);`)
  return fixture
}
describe('tenant database integrity', () => {
  it('protects the last administrator across assignment, membership, account and user mutations', () => {
    const f = database()
    try {
      for (const sql of [
        "DELETE FROM vc_tenant_assignments WHERE id='first'",
        'UPDATE vc_tenant_memberships SET active=0 WHERE user_id=1',
        'INSERT INTO vc_account_status VALUES(1,1)',
        'DELETE FROM users WHERE id=1',
      ])
        expect(() => f.sqlite.exec(sql)).toThrow(/last active Tenant Administrator/)
      f.sqlite.exec(
        "INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('second','one',2,'admin',NULL,1)",
      )
      f.sqlite.exec('INSERT INTO vc_account_status VALUES(1,1)')
      expect(() => f.sqlite.exec('INSERT INTO vc_account_status VALUES(2,1)')).toThrow(
        /last active Tenant Administrator/,
      )
      expect(f.sqlite.prepare('SELECT user_id FROM vc_active_tenant_administrators').all()).toEqual(
        [{ user_id: 2 }],
      )
    } finally {
      f.close()
    }
  })
  it('enforces tenant scope and immutable built-ins, and invalidates authority on retirement', () => {
    const f = database()
    try {
      expect(() =>
        f.sqlite.exec("UPDATE vc_tenant_roles SET builtin=NULL WHERE id='admin'"),
      ).toThrow(/immutable/)
      f.sqlite.exec(
        "INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('custom','one','Editor')",
      )
      expect(() =>
        f.sqlite.exec(
          "INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('bad','one',2,'custom','other',0)",
        ),
      ).toThrow(/FOREIGN KEY/)
      const before = f.sqlite
        .prepare("SELECT authority_revision FROM vc_organizations WHERE id='one'")
        .get()!
      f.sqlite.exec("UPDATE vc_tenant_roles SET retired=1 WHERE id='custom'")
      const after = f.sqlite
        .prepare("SELECT authority_revision FROM vc_organizations WHERE id='one'")
        .get()!
      expect(Number(after.authority_revision)).toBeGreaterThan(Number(before.authority_revision))
      expect(() =>
        f.sqlite.exec(
          "INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('bad','one',2,'custom','root',0)",
        ),
      ).toThrow(/retired/)
      expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      f.close()
    }
  })
})
