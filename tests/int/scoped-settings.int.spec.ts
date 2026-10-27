import { describe, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { categoriesEnabledForRequest } from '../../src/lib/system-settings'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { tenantSchemaV1 } from '../../src/organizations/tenant-schema-v1'
import {
  ScopedSettingsRepository,
  publicScopedSiteSettings,
  validateTenantSettings,
} from '../../src/organizations/scoped-settings'

function fixture() {
  const f = localD1()
  f.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'administrator'); CREATE TABLE pages(id INTEGER PRIMARY KEY,platform_site TEXT,_status TEXT,slug TEXT)",
  )
  for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...tenantSchemaV1])
    f.sqlite.exec(sql)
  f.sqlite.exec(`INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',1,1);
    UPDATE vc_site_websites SET initialized=1,published=1 WHERE site_id='default';
    INSERT INTO vc_tenant_roles(id,tenant_id,name,builtin) VALUES('admin','default','Tenant Administrator','tenant-administrator');
    INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,descendants) VALUES('admin','default',1,'admin',1);
    INSERT INTO pages VALUES(1,'default','published','home'),(2,'elsewhere','published','foreign'),(3,'default','draft','draft'),(4,'default','published','wiki');`)
  return { ...f, settings: new ScopedSettingsRepository(f.db, 1) }
}
describe('authoritative scoped settings', () => {
  it('keeps the outer mutation context when Payload initializes a nested global read', async () => {
    const context = {mutation: 'categories'}
    let reads = 0
    const req = {context, payload: {findGlobal: async ({req: nested}: {req: PayloadRequest}) => {
      reads++
      nested.context = {nested: true}
      return {categoriesEnabled: true}
    }}} as unknown as PayloadRequest
    expect(await categoriesEnabledForRequest(req)).toBe(true)
    expect(req.context).toBe(context)
    expect(req.context.mutation).toBe('categories')
    expect(await categoriesEnabledForRequest(req)).toBe(true)
    expect(reads).toBe(1)
  })
  it('supports the default site, shares public reads, preserves section values and rejects stale saves', async () => {
    const f = fixture()
    try {
      await f.settings.save({
        site: 'default',
        scope: 'site',
        expectedRevision: 0,
        operationKey: 'settings_create_12345',
        settings: { siteName: 'New name', homepage: 1 },
      })
      await f.settings.save({
        site: 'default',
        scope: 'site',
        expectedRevision: 1,
        operationKey: 'settings_update_12345',
        settings: { timezone: 'America/Chicago' },
      })
      expect((await f.settings.read('default')).settings).toMatchObject({
        siteName: 'New name',
        homepage: 1,
        timezone: 'America/Chicago',
      })
      expect((await publicScopedSiteSettings(f.db, 'default'))?.settings).toMatchObject({
        siteName: 'New name',
        homepage: 1,
      })
      await expect(
        f.settings.save({
          site: 'default',
          scope: 'site',
          expectedRevision: 1,
          operationKey: 'settings_stale_123456',
          settings: { siteName: 'Wrong' },
        }),
      ).rejects.toMatchObject({ status: 409 })
      expect((await f.settings.read('default')).settings.siteName).toBe('New name')
    } finally {
      f.close()
    }
  })
  it('rolls back foreign and draft page references and keeps tenant embed configuration out of site settings', async () => {
    const f = fixture()
    try {
      for (const id of [2, 3, 4])
        await expect(
          f.settings.save({
            site: 'default',
            scope: 'site',
            expectedRevision: 0,
            operationKey: `settings_badpage_${id}`,
            settings: { homepage: id },
          }),
        ).rejects.toMatchObject({ status: 409 })
      expect((await f.settings.read('default')).revision).toBe(0)
      expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM vc_platform_audit').get()?.n).toBe(0)
      await expect(
        f.settings.save({
          site: 'default',
          scope: 'site',
          expectedRevision: 0,
          operationKey: 'settings_wrongscope_1',
          settings: { workspaceEmbedOrigins: ['https://example.com'] },
        }),
      ).rejects.toThrow(/Unsupported/)
      await f.settings.save({
        site: 'default',
        scope: 'tenant',
        expectedRevision: 0,
        operationKey: 'settings_tenant_12345',
        settings: { workspaceEmbedOrigins: ['https://example.com'] },
      })
      expect((await f.settings.read('default', 'tenant')).settings.workspaceEmbedOrigins).toEqual([
        'https://example.com',
      ])
      expect(
        (await publicScopedSiteSettings(f.db, 'default'))?.settings.workspaceEmbedOrigins,
      ).toBeUndefined()
      expect(() =>
        validateTenantSettings({ workspaceEmbedOrigins: ['https://example.com/path'] }),
      ).toThrow()
    } finally {
      f.close()
    }
  })
})
