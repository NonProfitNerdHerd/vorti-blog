import { beforeAll, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { createChapterUser, fixtureRequest } from '../helpers/native-authority'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { CMS_AUDIENCE } from '@/publishing/readership'
import { cmsSiteContext } from '@/organizations/cms-scope'
import { PublishingTransfers } from '@/publishing/transfers'
import { PublishingSharing } from '@/publishing/sharing'
import type { User } from '@/payload-types'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
let payload: Payload, reader: User, source: number, file: number
const adminRequest = async () => { const req = await fixtureRequest(payload); Object.assign(req.context, { [CMS_AUDIENCE]: 'intranet' }); return req }
const readerRequest = () => createLocalReq({ user: { ...reader, collection: 'users' }, context: { ...cmsSiteContext('default'), [CMS_AUDIENCE]: 'intranet' } }, payload)
beforeAll(async () => {
  payload = await getPayload({ config })
  const admin = await fixtureRequest(payload), db = (payload.db as unknown as { client: D1Database }).client
  reader = await createChapterUser(payload, 'editor', { collection: 'users', data: { username: 'private-file-reader', email: 'private-file-reader@example.invalid', password: 'local-fixture-only-password', role: 'editor' } })
  await bootstrapTenant(db, { tenant: 'default', site: 'default', administratorEmail: admin.user!.email })
  await db.batch([
    db.prepare("INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',?,1)").bind(reader.id),
    db.prepare("INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('file-reader','default','File reader')"),
    db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('file-reader','intranet:read')"),
    db.prepare("INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('file-reader','default',?,'file-reader','default',0)").bind(reader.id),
  ])
  await activateTenantAuthority(db, 'default')
})
beforeAll(async () => {
  const req = await adminRequest()
  const doc = await payload.create({ collection: 'posts', req, draft: true, data: { title: 'Private file source', slug: 'private-file-source', author: Number(req.user!.id), audience: 'intranet' } })
  source = doc.id
  const upload = await adminRequest()
  upload.headers.set('x-vorticause-publishing-parent', JSON.stringify({ collection: 'posts', id: source }))
  const bytes = Buffer.from('internal file fixture')
  const media = await payload.create({ collection: 'media', req: upload, data: { alt: 'Protected source file', audience: 'intranet' }, file: { name: 'protected-source.txt', mimetype: 'text/plain', data: bytes, size: bytes.length } })
  file = media.id
  expect(media.url).toContain(`/publishing/media/${file}`)
})
it('keeps a draft-linked upload hidden from ordinary readers until its source is published', async () => {
  await expect(payload.findByID({ collection: 'media', id: file, req: await readerRequest(), depth: 0 })).rejects.toThrow()
  await payload.update({ collection: 'posts', id: source, req: await adminRequest(), data: { _status: 'published' } })
  expect((await payload.findByID({ collection: 'media', id: file, req: await readerRequest(), depth: 0 })).id).toBe(file)
  const listed = await payload.find({ collection: 'media', req: await readerRequest(), depth: 0,
    where: { and: [{ publishingSourceCollection: { equals: 'posts' } }, { publishingSourceID: { equals: source } }] } })
  expect(listed.docs.map(doc => doc.id)).toEqual([file])
  const original = await readerRequest(), req = { ...original, url: `http://local.invalid/api/publishing/media/${file}?site=default`, routeParams: { id: String(file) } }
  const endpoint = payload.config.endpoints.find(item => item.path === '/publishing/media/:id')!
  const response = await endpoint.handler(req)
  expect(response.status, await response.clone().text()).toBe(200)
  expect(await response.text()).toBe('internal file fixture')
})
it('retains protected file access after a source moves publicly, then revokes it with the last private readership', async () => {
  const sharing = new PublishingSharing(await adminRequest()), current = await sharing.read('default', 'posts', source)
  await sharing.save({ site: 'default', collection: 'posts', id: source, readership: 'restricted', people: [reader.id], groups: [], expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: 'private_file_readership_12345678' })
  const transfers = new PublishingTransfers(await adminRequest()), state = await transfers.read('default', 'posts', source)
  await transfers.execute({ site: 'default', collection: 'posts', id: source, destination: 'public', mode: 'move', slug: 'moved-private-file-source', expectedRevision: state.revision, expectedAuthorityRevision: state.authorityRevision, key: 'private_file_move_1234567890' })
  expect((await payload.findByID({ collection: 'media', id: file, req: await readerRequest(), depth: 0 })).id).toBe(file)
  const db = (payload.db as unknown as { client: D1Database }).client
  await db.prepare("UPDATE vc_tenant_memberships SET active=0 WHERE tenant_id='default' AND user_id=?").bind(reader.id).run()
  await expect(payload.findByID({ collection: 'media', id: file, req: await readerRequest(), depth: 0 })).rejects.toThrow()
})
it('still rejects a private media dependency when publishing a public Page with its own breadcrumb', async () => {
  const page = await payload.create({ collection: 'pages', req: await fixtureRequest(payload), draft: true, data: {
    title: 'Public dependency review', slug: 'public-dependency-review',
    contentLayout: { version: 1, nodes: [{ id: 'private-reference', kind: 'image', props: { mediaID: file } }] },
  } })
  try {
    await expect(payload.update({ collection: 'pages', id: page.id, req: await fixtureRequest(payload), data: { _status: 'published' } })).rejects.toMatchObject({ status: 400 })
    expect((await payload.findByID({ collection: 'pages', id: page.id, req: await fixtureRequest(payload), draft: true, depth: 0 }))._status).toBe('draft')
  } finally { await payload.delete({ collection: 'pages', id: page.id, req: await fixtureRequest(payload) }) }
})
