import { expect, it } from 'vitest'
import type { Endpoint, PayloadRequest } from 'payload'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '@/organizations/schema'
import { tenantSchemaV1 } from '@/organizations/tenant-schema-v1'
import { protectInternalFormEndpoints } from '@/forms/internal-host'
import { acceptSubmission } from '@/forms/acceptance'
import type { FormPlatform } from '@/forms/platform'

function fixture() {
  const f = localD1()
  f.sqlite.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT); INSERT INTO users VALUES(1,'editor'),(2,'editor')")
  for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...tenantSchemaV1]) f.sqlite.exec(sql)
  f.sqlite.exec(`INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',1,1),('default',2,1);
    INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('reader','default','Reader');
    INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('reader','intranet:read');
    INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('reader','default',1,'reader','default',0);
    INSERT INTO vc_tenant_features(tenant_id,feature,available) VALUES('default','intranet',1),('default','forms',1);`)
  const platform: FormPlatform = { db: f.db, storage: {} as R2Bucket, resolveSite: () => 'default' }
  const req = (actor: number | null, internal = true) => ({ user: actor ? { id: actor, collection: 'users' } : null,
    headers: new Headers(internal ? { 'x-vorti-form-host': 'intranet' } : {}), context: {}, url: 'https://fixture.invalid/api/forms-runtime/news' }) as unknown as PayloadRequest
  const endpoint = (handler: Endpoint['handler']) => protectInternalFormEndpoints([{ path: '/forms-runtime/news', method: 'get', handler }], platform)[0]
  return { ...f, req, endpoint }
}

it('requires current internal membership and both features even for a forged placement hint', async () => {
  const f = fixture()
  try {
    let calls = 0
    const endpoint = f.endpoint(async () => { calls++; return Response.json({ available: true }) })
    expect((await endpoint.handler(f.req(null))).status).toBe(401)
    expect((await endpoint.handler(f.req(2))).status).toBe(403)
    const allowed = await endpoint.handler(f.req(1))
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('Cache-Control')).toBe('private, no-store')
    expect(allowed.headers.get('X-Robots-Tag')).toContain('noindex')
    // There is deliberately no public-website table: internal placements do not
    // depend on an initialized or published public website.
    expect(calls).toBe(1)
    f.sqlite.exec("UPDATE vc_tenant_features SET available=0 WHERE feature='forms'")
    expect((await endpoint.handler(f.req(1))).status).toBe(403)
    expect(calls).toBe(1)
    expect((await endpoint.handler(f.req(null, false))).status).toBe(200)
  } finally { f.close() }
})

it('discards a response if authority changes while the internal endpoint is running', async () => {
  const f = fixture()
  try {
    const endpoint = f.endpoint(async () => {
      f.sqlite.exec("UPDATE vc_tenant_features SET available=0 WHERE feature='intranet'")
      return Response.json({ protected: 'must-not-be-returned' })
    })
    const response = await endpoint.handler(f.req(1))
    expect(response.status).toBe(409)
    expect(await response.text()).not.toContain('must-not-be-returned')
  } finally { f.close() }
})

it('rejects a raw internal submission without a server-derived actor before touching submission storage', async () => {
  const f = fixture()
  try {
    await expect(acceptSubmission(f.db, { formID: 1, site: 'default', revision: 'fixture', key: 'fixture', sessionHash: 'fixture', answers: {},
      snapshot: { title: 'Fixture', fields: [] }, actions: [], payment: false, attachments: [], hostFeature: 'intranet' })).rejects.toMatchObject({ status: 401 })
  } finally { f.close() }
})
