import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { tenantSchemaV1 } from '../../src/organizations/tenant-schema-v1'

describe('last Tenant Administrator protection on D1', () => {
  let proxy: PlatformProxy<{ D1: D1Database }>
  beforeAll(async () => {
    proxy = await getPlatformProxy<{ D1: D1Database }>({
      configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
      persist: false,
      remoteBindings: false,
    })
    const db = proxy.env.D1
    for (const statement of [
      'CREATE TABLE users(id INTEGER PRIMARY KEY)',
      'CREATE TABLE vc_organizations(id TEXT PRIMARY KEY,authority_revision INTEGER NOT NULL DEFAULT 1)',
      'CREATE TABLE vc_sites(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,UNIQUE(id,organization_id))',
      'CREATE TABLE vc_account_status(user_id INTEGER PRIMARY KEY REFERENCES users(id),disabled INTEGER NOT NULL)',
      ...tenantSchemaV1,
      'INSERT INTO users VALUES(1),(2)',
      "INSERT INTO vc_organizations(id) VALUES('tenant')",
      "INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('tenant',1,1),('tenant',2,1)",
      "INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('admin','tenant','Tenant Administrator','tenant-administrator')",
      "INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,descendants) VALUES('first','tenant',1,'admin',1),('second','tenant',2,'admin',1)",
    ])
      await db.prepare(statement).run()
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  it('permits only one competing suspension/removal and rolls the losing mutation back', async () => {
    const db = proxy.env.D1
    const results = await Promise.allSettled([
      db
        .prepare("UPDATE vc_tenant_memberships SET active=0 WHERE tenant_id='tenant' AND user_id=1")
        .run(),
      db.prepare("DELETE FROM vc_tenant_assignments WHERE id='second'").run(),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM vc_active_tenant_administrators')
          .first<{ n: number }>()
      )?.n,
    ).toBe(1)
    const survivor = await db
      .prepare('SELECT user_id FROM vc_active_tenant_administrators')
      .first<{ user_id: number }>()
    await expect(
      db
        .prepare('INSERT INTO vc_account_status(user_id,disabled) VALUES(?,1)')
        .bind(survivor!.user_id)
        .run(),
    ).rejects.toThrow(/last active Tenant Administrator/)
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
})
