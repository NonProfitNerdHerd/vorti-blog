import { describe, expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { tenantSchemaV1 } from '../../src/organizations/tenant-schema-v1'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { OrganizationRepository } from '../../src/organizations/repository'
import { TenantRepository } from '../../src/organizations/tenant-repository'

describe('activated tenant runtime', () => {
  it('uses tenant grants in existing repositories and removes the global operator bypass', async () => {
    const f = localD1()
    try {
      f.sqlite.exec(
        "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,email TEXT,hash TEXT); INSERT INTO users VALUES(1,'administrator','admin@example.com','unchanged-credential')",
      )
      for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...tenantSchemaV1])
        f.sqlite.exec(sql)
      f.sqlite.exec(
        "INSERT INTO vc_organizations(id,name,created_at,updated_at) VALUES('other','Other','now','now'); INSERT INTO vc_sites(id,organization_id,name,route_key,created_at,updated_at) VALUES('other','other','Other','other','now','now')",
      )
      const existing = new OrganizationRepository(f.db, 1)
      expect(await existing.isOperator()).toBe(true)
      await bootstrapTenant(f.db, {
        tenant: 'default',
        site: 'default',
        administratorEmail: 'ADMIN@example.com',
      })
      await bootstrapTenant(f.db, {
        tenant: 'default',
        site: 'default',
        administratorEmail: 'admin@example.com',
      })
      await activateTenantAuthority(f.db, 'default')
      expect(await existing.isOperator()).toBe(false)
      const matrix = await existing.authoritySet('default')
      expect(matrix).toMatchObject({ operator: false, tenantAdministrator: true })
      expect(matrix.allowed.content).toContain('edit')
      await expect(existing.require('other', 'content', 'read')).rejects.toMatchObject({
        status: 403,
      })
      expect(f.sqlite.prepare('SELECT hash FROM users WHERE id=1').get()?.hash).toBe(
        'unchanged-credential',
      )
      expect(() => f.sqlite.exec('DELETE FROM vc_tenant_installation')).toThrow(
        /cannot be disabled/,
      )
      const repo = new TenantRepository(f.db, 1)
      const snapshot = await repo.snapshot('default')
      await repo.setFeature({
        contextSite: 'default',
        site: null,
        feature: 'tasks',
        value: false,
        expectedAuthorityRevision: snapshot.revision,
        key: 'disable_tasks_runtime_1',
      })
      await expect(existing.require('default', 'workspace', 'read')).rejects.toMatchObject({
        status: 403,
      })
      await expect(existing.require('default', 'content', 'configure')).resolves.toMatchObject({
        id: 'default',
      })
      f.sqlite.exec(`INSERT INTO users VALUES(2,'editor','reader@example.invalid','synthetic');
        INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',2,1);
        INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('identity-reader','default','Identity reader');
        INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('identity-reader','crm:read'),('identity-reader','crm:read-identity');
        INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('identity-reader','default',2,'identity-reader','default',0);`)
      const reader = new OrganizationRepository(f.db, 2)
      await expect(reader.require('default', 'identity', 'read')).resolves.toMatchObject({id: 'default'})
      await expect(reader.require('default', 'finances', 'read')).rejects.toMatchObject({status: 403})
      f.sqlite.exec("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('identity-reader','crm:read-finances')")
      await expect(reader.require('default', 'finances', 'read')).resolves.toMatchObject({id: 'default'})
      f.sqlite.exec("DELETE FROM vc_tenant_role_permissions WHERE role_id='identity-reader' AND permission='crm:read'")
      await expect(reader.require('default', 'finances', 'read')).rejects.toMatchObject({status: 403})
    } finally {
      f.close()
    }
  })
})
