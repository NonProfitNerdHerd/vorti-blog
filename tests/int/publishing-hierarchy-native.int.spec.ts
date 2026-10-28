import { beforeAll, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { createChapterUser, fixtureRequest } from '../helpers/native-authority'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { CMS_AUDIENCE } from '@/publishing/readership'
import { cmsSiteContext } from '@/organizations/cms-scope'
import type { Page, User } from '@/payload-types'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
let payload: Payload, reader: User, open: Page, restricted: Page, child: Page, external: Page
const admin = async () => {
  const req = await fixtureRequest(payload)
  Object.assign(req.context, { [CMS_AUDIENCE]: 'intranet' })
  return req
}
const readerRequest = () => createLocalReq({ user: { ...reader, collection: 'users' }, context: { ...cmsSiteContext('default'), [CMS_AUDIENCE]: 'intranet' } }, payload)
beforeAll(async () => {
  payload = await getPayload({ config })
  const initial = await fixtureRequest(payload), db = (payload.db as unknown as { client: D1Database }).client
  reader = await createChapterUser(payload, 'editor', { collection: 'users', data: { username: 'hierarchy-reader', email: 'hierarchy-reader@example.invalid', password: 'local-fixture-only-password', role: 'editor' } })
  await bootstrapTenant(db, { tenant: 'default', site: 'default', administratorEmail: initial.user!.email })
  await db.batch([
    db.prepare("INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',?,1)").bind(reader.id),
    db.prepare("INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('hierarchy-reader','default','Hierarchy reader')"),
    db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('hierarchy-reader','intranet:read')"),
    db.prepare("INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('hierarchy-reader','default',?,'hierarchy-reader','default',0)").bind(reader.id),
  ])
  await activateTenantAuthority(db, 'default')
})
beforeAll(async () => {
  open = await payload.create({ collection: 'pages', req: await admin(), data: { title: 'Open parent', slug: 'open-parent', audience: 'intranet', _status: 'published' } })
  restricted = await payload.create({ collection: 'pages', req: await admin(), data: { title: 'Restricted parent', slug: 'restricted-parent', audience: 'intranet', publishingReadership: 'restricted', _status: 'published' } })
  child = await payload.create({ collection: 'pages', req: await admin(), data: { title: 'Child resource', slug: 'duplicate-page-slug', parent: open.id, audience: 'intranet', _status: 'published' } })
  external = await payload.create({ collection: 'pages', req: await fixtureRequest(payload), data: { title: 'Public resource', slug: 'duplicate-page-slug', _status: 'published' } })
})

it('allows duplicate public/internal slugs but rejects a parent from another audience', async () => {
  expect(child.slug).toBe(external.slug)
  await expect(payload.update({ collection: 'pages', id: child.id, req: await admin(), data: { parent: external.id } })).rejects.toThrow()
})
it('publishes an existing internal draft without treating its generated self breadcrumb as a separate unpublished dependency', async () => {
  const page = await payload.create({ collection: 'pages', req: await admin(), draft: true, data: { title: 'Draft resource publication', slug: 'draft-resource-publication', audience: 'intranet' } })
  try {
    await expect(payload.findByID({ collection: 'pages', id: page.id, req: await readerRequest(), depth: 0 })).rejects.toThrow()
    await payload.update({ collection: 'pages', id: page.id, req: await admin(), data: { _status: 'published' } })
    expect((await payload.findByID({ collection: 'pages', id: page.id, req: await readerRequest(), depth: 0 })).title).toBe('Draft resource publication')
  } finally { await payload.delete({ collection: 'pages', id: page.id, req: await admin() }) }
})
it('rechecks ancestors after reparenting for fresh and already-used requests, lists and counts', async () => {
  const sameRequest = await readerRequest()
  expect((await payload.findByID({ collection: 'pages', id: child.id, req: sameRequest, depth: 0 })).id).toBe(child.id)
  try {
    await payload.update({ collection: 'pages', id: child.id, req: await admin(), data: { parent: restricted.id } })
    await expect(payload.findByID({ collection: 'pages', id: child.id, req: sameRequest, depth: 0 })).rejects.toThrow()
    await expect(payload.findByID({ collection: 'pages', id: child.id, req: await readerRequest(), depth: 0 })).rejects.toThrow()
    expect((await payload.count({ collection: 'pages', req: await readerRequest(), where: { id: { equals: child.id } } })).totalDocs).toBe(0)
    expect((await payload.find({ collection: 'pages', req: await readerRequest(), where: { id: { equals: child.id } } })).docs).toEqual([])
  } finally { await payload.update({ collection: 'pages', id: child.id, req: await admin(), data: { parent: open.id } }) }
})
it('rejects a hierarchy cycle without changing either record', async () => {
  await expect(payload.update({ collection: 'pages', id: open.id, req: await admin(), data: { parent: child.id } })).rejects.toThrow()
  const db = (payload.db as unknown as { client: D1Database }).client
  expect((await db.prepare('SELECT parent_id FROM pages WHERE id=?').bind(open.id).first<{ parent_id: number | null }>())!.parent_id).toBeNull()
  expect((await db.prepare('SELECT parent_id FROM pages WHERE id=?').bind(child.id).first<{ parent_id: number }>())!.parent_id).toBe(open.id)
})
