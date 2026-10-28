import { beforeAll, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { createChapterUser, fixtureRequest } from '../helpers/native-authority'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { CMS_AUDIENCE } from '@/publishing/readership'
import { cmsSiteContext } from '@/organizations/cms-scope'
import { PublishingSharing } from '@/publishing/sharing'
import type { User } from '@/payload-types'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
let payload: Payload, reader: User, source: number, file: number
const readerRequest = () => createLocalReq({ user: { ...reader, collection: 'users' }, context: { ...cmsSiteContext('default'), [CMS_AUDIENCE]: 'intranet' } }, payload)
beforeAll(async () => {
  payload = await getPayload({ config })
  const admin = await fixtureRequest(payload), db = (payload.db as unknown as { client: D1Database }).client
  reader = await createChapterUser(payload, 'editor', { collection: 'users', data: { username: 'export-reader', email: 'export-reader@example.invalid', password: 'local-fixture-only-password', role: 'editor' } })
  await bootstrapTenant(db, { tenant: 'default', site: 'default', administratorEmail: admin.user!.email })
  await db.batch([
    db.prepare("INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',?,1)").bind(reader.id),
    db.prepare("INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('export-reader','default','Export reader')"),
    db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('export-reader','intranet:read'),('export-reader','intranet:read-history')"),
    db.prepare("INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('export-reader','default',?,'export-reader','default',0)").bind(reader.id),
  ])
  await activateTenantAuthority(db, 'default')
})
beforeAll(async () => {
  const pub = await fixtureRequest(payload)
  await payload.create({ collection: 'posts', req: pub, data: { title: 'Public export decoy', slug: 'export-same-slug', author: Number(pub.user!.id), _status: 'published' } })
  const internal = await fixtureRequest(payload); Object.assign(internal.context, { [CMS_AUDIENCE]: 'intranet' })
  source = (await payload.create({ collection: 'posts', req: internal, data: { title: 'Internal export source', slug: 'export-same-slug', author: Number(internal.user!.id), audience: 'intranet', _status: 'published' } })).id
  const doc = await payload.create({ collection: 'exports', req: await readerRequest(), data: { name: 'Internal fixture export', collectionSlug: 'posts', format: 'json', drafts: 'no', audience: 'intranet' } })
  file = doc.id
  expect(doc.url).toContain(`/publishing/files/exports/${file}`)
  expect(doc.filename).toBeTruthy()
  const row = await (payload.db as unknown as { client: D1Database }).client.prepare('SELECT prefix,filename,publishing_owner FROM exports WHERE id=?').bind(file).first<{ prefix: string; filename: string; publishing_owner: number }>()
  expect(row?.prefix).toMatch(/^__intranet__\//)
  expect(row?.filename).toBe(doc.filename)
  expect(row?.publishing_owner).toBe(reader.id)
})
async function download(anonymous = false) {
  const original = anonymous ? await createLocalReq({}, payload) : await readerRequest()
  const req = { ...original, url: `http://local.invalid/api/publishing/files/exports/${file}?site=default`, routeParams: { collection: 'exports', id: String(file) } }
  const endpoint = payload.config.endpoints.find(item => item.path === '/publishing/files/:collection/:id')!
  return endpoint.handler(req)
}
it('exports only the selected internal area into a protected file with a verified source manifest', async () => {
  const response = await download()
  expect(response.status, await response.clone().text()).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  const rows = await response.json() as Array<{ id: number; title: string; audience: string }>
  expect(rows.map(row => row.id)).toEqual([source])
  expect(rows[0]).toMatchObject({ title: 'Internal export source', audience: 'intranet' })
})
it('does not deliver private export files anonymously', async () => {
  expect((await download(true)).status).toBe(404)
})
it('revokes an existing export download when its owner loses access to a source record', async () => {
  const sharing = new PublishingSharing(await fixtureRequest(payload)), current = await sharing.read('default', 'posts', source)
  await sharing.save({ site: 'default', collection: 'posts', id: source, readership: 'restricted', people: [], groups: [], expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: 'revoke_export_source_123456789' })
  expect((await download()).status).toBe(403)
})
