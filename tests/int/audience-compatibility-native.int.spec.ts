import { beforeAll, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { fixtureRequest } from '../helpers/native-authority'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
let payload: Payload, db: D1Database, internal: number, publicID: number
beforeAll(async () => {
  payload = await getPayload({ config })
  db = (payload.db as unknown as { client: D1Database }).client
  for (const [slug, title] of [['compat-public', 'Public fixture'], ['compat-internal', 'Internal fixture']]) {
    const req = await fixtureRequest(payload)
    const post = await payload.create({
      collection: 'posts', req,
      data: { title, slug, author: Number(req.user!.id), _status: 'published' },
    })
    if (slug === 'compat-public') publicID = post.id
    else internal = post.id
  }
  // Simulate the later unified publisher's records, including history. The recovery
  // build must remain safe when these rows already exist in its expanded database.
  await db.batch([
    db.prepare("UPDATE posts SET audience='intranet' WHERE id=?").bind(internal),
    db.prepare("UPDATE _posts_v SET version_audience='intranet' WHERE parent_id=?").bind(internal),
  ])
})

it('excludes internal rows from privileged Local API lists, counts and versions', async () => {
  const req = await fixtureRequest(payload)
  const list = await payload.find({ collection: 'posts', req, overrideAccess: true, depth: 0 })
  expect(list.docs.map(doc => doc.id)).toContain(publicID)
  expect(list.docs.map(doc => doc.id)).not.toContain(internal)
  const count = await payload.count({ collection: 'posts', req: await fixtureRequest(payload), overrideAccess: true, where: { id: { equals: internal } } })
  expect(count.totalDocs).toBe(0)
  const versions = await payload.findVersions({ collection: 'posts', req: await fixtureRequest(payload), overrideAccess: true, where: { parent: { equals: internal } } })
  expect(versions.totalDocs).toBe(0)
})

it('denies direct internal reads, changes, deletes and history restoration', async () => {
  await expect(payload.findByID({ collection: 'posts', id: internal, req: await fixtureRequest(payload), overrideAccess: true })).rejects.toThrow()
  await expect(payload.update({ collection: 'posts', id: internal, req: await fixtureRequest(payload), overrideAccess: true, data: { title: 'Must not save' } })).rejects.toThrow()
  await expect(payload.delete({ collection: 'posts', id: internal, req: await fixtureRequest(payload), overrideAccess: true })).rejects.toThrow()
  const version = await db.prepare('SELECT id FROM _posts_v WHERE parent_id=? ORDER BY id DESC LIMIT 1').bind(internal).first<{ id: number }>()
  expect(version).not.toBeNull()
  await expect(payload.restoreVersion({ collection: 'posts', id: String(version!.id), req: await fixtureRequest(payload), overrideAccess: true })).rejects.toThrow()
  expect(await db.prepare('SELECT title,audience FROM posts WHERE id=?').bind(internal).first()).toEqual({ title: 'Internal fixture', audience: 'intranet' })
})

it('retains normal public saves and rejects a forged audience switch', async () => {
  const post = await payload.update({ collection: 'posts', id: publicID, req: await fixtureRequest(payload), data: { title: 'Public edited' } })
  expect(post.audience).toBe('public')
  await expect(payload.update({ collection: 'posts', id: publicID, req: await fixtureRequest(payload), data: { audience: 'intranet' } })).rejects.toThrow()
  expect((await payload.findByID({ collection: 'posts', id: publicID, req: await fixtureRequest(payload) })).title).toBe('Public edited')
})
