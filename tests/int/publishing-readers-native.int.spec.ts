import { beforeAll, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { createChapterUser, fixtureRequest } from '../helpers/native-authority'
import { CMS_AUDIENCE } from '@/publishing/readership'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { cmsSiteContext } from '@/organizations/cms-scope'
import { PublishingSharing } from '@/publishing/sharing'
import { PublishingTransfers } from '@/publishing/transfers'
import { privatePublishingHistory } from '@/publishing/private-history'
import { notify } from '@/review/workspace-collections'
import type { User } from '@/payload-types'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
let payload: Payload, publicID: number, internalID: number, reader: User
const parentID = (parent: unknown) => Number(parent && typeof parent === 'object' && 'id' in parent ? parent.id : parent)
const readerRequest = () => createLocalReq({ user: { ...reader, collection: 'users' }, context: { ...cmsSiteContext('default'), [CMS_AUDIENCE]: 'intranet' } }, payload)
beforeAll(async () => {
  payload = await getPayload({ config })
  const initial = await fixtureRequest(payload)
  const db = (payload.db as unknown as { client: D1Database }).client
  reader = await createChapterUser(payload, 'editor', { collection: 'users', data: {
    username: 'internal-native-reader', email: 'internal-native-reader@example.invalid', password: 'local-fixture-only-password', role: 'editor',
  } })
  await bootstrapTenant(db, { tenant: 'default', site: 'default', administratorEmail: initial.user!.email })
  await db.batch([
    db.prepare("INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',?,1)").bind(reader.id),
    db.prepare("INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('internal-reader','default','Internal reader')"),
    db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('internal-reader','intranet:read')"),
    db.prepare("INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('internal-reader','default',?,'internal-reader','default',0)").bind(reader.id),
  ])
  await activateTenantAuthority(db, 'default')
  const queries: Array<{ sql: string; parameters: unknown[] }> = []
  const session = (payload.db as unknown as { drizzle: { session: { logger: { logQuery(sql: string, parameters: unknown[]): void } } } }).drizzle.session
  const originalLogger = session.logger
  session.logger = { logQuery(sql, parameters) { queries.push({ sql, parameters }) } }
  const req = await fixtureRequest(payload)
  const publicPost = await payload.create({ collection: 'posts', req,
    data: { title: 'Public native reader', slug: 'public-native-reader', author: Number(req.user!.id), _status: 'published' } })
  publicID = publicPost.id
  const visible = await payload.find({ collection: 'posts', req: await fixtureRequest(payload), depth: 0 })
  expect(visible.docs.map(doc => doc.id), JSON.stringify(queries.filter(query => query.sql.includes('vc_pub_posts_readers')).slice(-3))).toContain(publicID)
  session.logger = originalLogger
  const internalReq = await fixtureRequest(payload)
  Object.assign(internalReq.context, { [CMS_AUDIENCE]: 'intranet' })
  const internalPost = await payload.create({ collection: 'posts', req: internalReq,
    data: { title: 'Internal native reader', slug: 'internal-native-reader', author: Number(internalReq.user!.id), audience: 'intranet', _status: 'published' } })
  internalID = internalPost.id
})

it('uses native joins for audience-filtered lists and counts', async () => {
  const publicPosts = await payload.find({ collection: 'posts', req: await fixtureRequest(payload), depth: 0 })
  expect(publicPosts.docs.map(doc => doc.id)).toContain(publicID)
  expect(publicPosts.docs.map(doc => doc.id)).not.toContain(internalID)
  const req = await fixtureRequest(payload)
  Object.assign(req.context, { [CMS_AUDIENCE]: 'intranet' })
  const internal = await payload.find({ collection: 'posts', req, depth: 0 })
  expect(internal.docs.map(doc => doc.id)).toContain(internalID)
  expect(internal.docs.map(doc => doc.id)).not.toContain(publicID)
  const countReq = await fixtureRequest(payload)
  Object.assign(countReq.context, { [CMS_AUDIENCE]: 'intranet' })
  expect((await payload.count({ collection: 'posts', req: countReq })).totalDocs).toBe(internal.totalDocs)
})

it('keeps administrator notification lists and counts within SQLite’s join budget', async () => {
  const options = { collection: 'task-notifications' as const, req: await fixtureRequest(payload), overrideAccess: false, where: { read: { not_equals: true } } }
  expect((await payload.count(options)).totalDocs).toBeGreaterThanOrEqual(0)
  expect((await payload.find({ ...options, depth: 0, limit: 10 })).docs).toBeInstanceOf(Array)
})

it('rejects an internal destination in a public menu even when navigation allows same-area drafts', async () => {
  await expect(payload.create({ collection: 'menus', req: await fixtureRequest(payload), data: {
    name: 'Invalid public internal link', items: [{ key: 'private', label: 'Internal destination', kind: 'post', target: internalID }],
  } })).rejects.toThrow(/dependency review|public/)
})

it('queries current-parent readership for native version lists', async () => {
  const publicVersions = await payload.findVersions({ collection: 'posts', req: await fixtureRequest(payload), depth: 0 })
  expect(publicVersions.docs.some(doc => parentID(doc.parent) === publicID)).toBe(true)
  expect(publicVersions.docs.some(doc => parentID(doc.parent) === internalID)).toBe(false)
  const req = await fixtureRequest(payload)
  Object.assign(req.context, { [CMS_AUDIENCE]: 'intranet' })
  const internalVersions = await payload.findVersions({ collection: 'posts', req, depth: 0 })
  expect(internalVersions.docs.some(doc => parentID(doc.parent) === internalID)).toBe(true)
})

it('revokes an ordinary reader across direct reads, lists, counts and search without granting history', async () => {
  expect((await payload.findByID({ collection: 'posts', id: internalID, req: await readerRequest(), depth: 0 })).id).toBe(internalID)
  expect((await payload.find({ collection: 'search', req: await readerRequest(), depth: 0 })).totalDocs).toBeGreaterThan(0)
  await expect(payload.findVersions({ collection: 'posts', req: await readerRequest(), depth: 0 })).rejects.toThrow()
  const sharing = new PublishingSharing(await fixtureRequest(payload))
  const current = await sharing.read('default', 'posts', internalID)
  await sharing.save({ site: 'default', collection: 'posts', id: internalID, readership: 'restricted', people: [], groups: [],
    expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: 'native_restrict_123456789' })
  await expect(payload.findByID({ collection: 'posts', id: internalID, req: await readerRequest(), overrideAccess: true, depth: 0 })).rejects.toThrow()
  expect((await payload.find({ collection: 'posts', req: await readerRequest(), overrideAccess: true, depth: 0 })).docs).toEqual([])
  expect((await payload.count({ collection: 'posts', req: await readerRequest(), overrideAccess: true })).totalDocs).toBe(0)
  expect((await payload.find({ collection: 'search', req: await readerRequest(), overrideAccess: true, depth: 0 })).docs).toEqual([])
})

it('does not expose authorization-view records through privileged Local API calls', async () => {
  await expect(payload.find({ collection: 'publishing-posts-readers', req: await fixtureRequest(payload), overrideAccess: true })).rejects.toThrow('no document API')
})

it('does not expose an old internal version through a currently public parent', async () => {
  const db = (payload.db as unknown as { client: D1Database }).client
  const version = await db.prepare('SELECT id FROM _posts_v WHERE parent_id=? ORDER BY id DESC LIMIT 1').bind(publicID).first<{ id: number }>()
  expect(version).not.toBeNull()
  await db.prepare("UPDATE _posts_v SET version_audience='intranet' WHERE id=?").bind(version!.id).run()
  await expect(payload.findVersionByID({ collection: 'posts', id: String(version!.id), req: await fixtureRequest(payload), overrideAccess: true })).rejects.toThrow()
})

it('keeps create, edit and publishing grants distinct for internal authors', async () => {
  const db = (payload.db as unknown as { client: D1Database }).client
  await db.batch(['intranet:create', 'intranet:read-history'].map(permission => db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('internal-reader',?)").bind(permission)))
  const draft = await payload.create({ collection: 'posts', req: await readerRequest(), draft: true, data: {
    title: 'Create permission only', slug: 'create-permission-only', author: reader.id, audience: 'intranet', _status: 'draft',
  } })
  expect(draft.audience).toBe('intranet')
  expect((await payload.findByID({ collection: 'posts', id: draft.id, req: await readerRequest(), draft: true })).title).toBe('Create permission only')
  await expect(payload.update({ collection: 'posts', id: draft.id, req: await readerRequest(), draft: true, data: { title: 'Unauthorized edit' } })).rejects.toThrow()
  await expect(payload.delete({ collection: 'posts', id: draft.id, req: await readerRequest() })).rejects.toThrow()
  await expect(payload.create({ collection: 'posts', req: await readerRequest(), data: {
    title: 'Unauthorized publication', slug: 'unauthorized-publication', author: reader.id, audience: 'intranet', _status: 'published',
  } })).rejects.toThrow()
})

it.each(['public', 'intranet'] as const)('does not return a newer %s draft to an editor without history permission through reads or updates', async audience => {
  const db = (payload.db as unknown as { client: D1Database }).client
  await db.batch([
    db.prepare("DELETE FROM vc_tenant_role_permissions WHERE role_id='internal-reader' AND permission=?").bind(audience === 'public' ? 'posts:read-history' : 'intranet:read-history'),
    ...['intranet:edit', 'posts:read-published', 'posts:edit'].map(permission => db.prepare("INSERT OR IGNORE INTO vc_tenant_role_permissions(role_id,permission) VALUES('internal-reader',?)").bind(permission)),
  ])
  const ids: number[] = []
  try {
      const admin = async () => {
        const req = await fixtureRequest(payload)
        Object.assign(req.context, { [CMS_AUDIENCE]: audience })
        return req
      }
      const editor = async () => {
        const req = await readerRequest()
        Object.assign(req.context, { [CMS_AUDIENCE]: audience })
        return req
      }
      const doc = await payload.create({ collection: 'posts', req: await admin(), data: {
        title: `${audience} published version`, slug: `${audience}-draft-privacy`, author: Number((await admin()).user!.id), audience, _status: 'published',
      } })
      ids.push(doc.id)
      await payload.update({ collection: 'posts', id: doc.id, req: await admin(), draft: true, data: { title: 'Private unreleased draft', _status: 'draft' } })
      expect((await payload.findByID({ collection: 'posts', id: doc.id, req: await editor(), depth: 0 })).title).toBe(`${audience} published version`)
      await expect(payload.findByID({ collection: 'posts', id: doc.id, req: await editor(), draft: true, depth: 0 })).rejects.toThrow()
      await expect(payload.find({ collection: 'posts', req: await editor(), draft: true, depth: 0 })).rejects.toThrow()
      for (const draft of [false, true]) {
        await expect(payload.update({ collection: 'posts', id: doc.id, req: await editor(), draft, data: { title: 'Attempted edit without history' } })).rejects.toThrow()
      }
      const permission = audience === 'intranet' ? 'intranet:read-history' : 'posts:read-history'
      await db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('internal-reader',?)").bind(permission).run()
      expect((await payload.update({ collection: 'posts', id: doc.id, req: await editor(), draft: true, data: { title: 'Authorized draft edit' } })).title).toBe('Authorized draft edit')
  } finally {
    for (const id of ids) await payload.delete({ collection: 'posts', id, req: await fixtureRequest(payload) })
  }
})

it.each(['posts', 'pages'] as const)('copies %s once into destination drafts, fences revisions and moves without discarding history', async collection => {
    const req = await fixtureRequest(payload)
    const source = await payload.create({ collection, req, data: {
      title: `${collection} transfer`, slug: `${collection}-transfer`, ...(collection === 'posts' ? { author: Number(req.user!.id) } : {}), _status: 'published',
    } })
    let copyID: number | null = null
    try {
      await payload.update({ collection, id: source.id, req: await fixtureRequest(payload), draft: true, data: { title: 'Latest transferred draft', _status: 'draft' } })
      const service = new PublishingTransfers(await fixtureRequest(payload))
      const current = await service.read('default', collection, source.id)
      const input = { site: 'default', collection, id: source.id, destination: 'intranet' as const, mode: 'copy' as const, slug: `${collection}-transfer-copy`,
        expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: `copy_${collection}_1234567890` }
      const result = await service.execute(input)
      copyID = Number(result.id)
      expect(await new PublishingTransfers(await fixtureRequest(payload)).execute(input)).toEqual(result)
      await expect(new PublishingTransfers(await fixtureRequest(payload)).execute({ ...input, slug: 'different-retry' })).rejects.toMatchObject({ status: 409 })
      const copied = await payload.findByID({ collection, id: copyID, req: await fixtureRequest(payload), draft: true, depth: 0 })
      expect(copied).toMatchObject({ title: 'Latest transferred draft', audience: 'intranet', _status: 'draft', publishingLineage: `copy:${collection}:${source.id}` })
      expect((await payload.findByID({ collection, id: source.id, req: await fixtureRequest(payload), depth: 0 })).audience).toBe('public')
      const moveService = new PublishingTransfers(await fixtureRequest(payload)), fresh = await moveService.read('default', collection, source.id)
      await expect(moveService.execute({ ...input, mode: 'move', slug: `${collection}-transfer-moved`, key: `stale_${collection}_1234567890` })).rejects.toMatchObject({ status: 409 })
      const db = (payload.db as unknown as { client: D1Database }).client
      const before = await db.prepare(`SELECT COUNT(*) n FROM _${collection}_v WHERE parent_id=?`).bind(source.id).first<{ n: number }>()
      await moveService.execute({ ...input, mode: 'move', slug: `${collection}-transfer-moved`, expectedRevision: fresh.revision, expectedAuthorityRevision: fresh.authorityRevision, key: `move_${collection}_1234567890` })
      expect((await payload.findByID({ collection, id: source.id, req: await fixtureRequest(payload), draft: true, depth: 0 }))).toMatchObject({ audience: 'intranet', _status: 'draft', title: 'Latest transferred draft' })
      expect((await db.prepare(`SELECT COUNT(*) n FROM _${collection}_v WHERE parent_id=?`).bind(source.id).first<{ n: number }>())!.n).toBe(before!.n + 1)
      expect((await payload.find({ collection, req: await fixtureRequest(payload), where: { id: { equals: source.id } } })).docs).toEqual([])
    } finally {
      if (copyID) await payload.delete({ collection, id: copyID, req: await fixtureRequest(payload) })
      await payload.delete({ collection, id: source.id, req: await fixtureRequest(payload) })
    }
})

it('retains the final internal readership across private history after moving a record publicly', async () => {
  const admin = await fixtureRequest(payload)
  Object.assign(admin.context, { [CMS_AUDIENCE]: 'intranet' })
  const doc = await payload.create({ collection: 'posts', req: admin, data: { title: 'Historical private body', slug: 'historical-private-body', author: Number(admin.user!.id), audience: 'intranet', _status: 'published' } })
  try {
    const sharing = new PublishingSharing(await fixtureRequest(payload)), original = await sharing.read('default', 'posts', doc.id)
    await sharing.save({ site: 'default', collection: 'posts', id: doc.id, readership: 'restricted', people: [], groups: [], expectedRevision: original.revision,
      expectedAuthorityRevision: original.authorityRevision, key: 'restrict_before_move_12345678' })
    const transfer = new PublishingTransfers(await fixtureRequest(payload)), current = await transfer.read('default', 'posts', doc.id)
    await transfer.execute({ site: 'default', collection: 'posts', id: doc.id, destination: 'public', mode: 'move', slug: 'historical-public-draft',
      expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: 'private_public_move_12345678' })
    const privateRequest = async (ordinary: boolean) => {
      const req = ordinary ? await readerRequest() : await fixtureRequest(payload)
      return { ...req, url: `http://local.invalid/api/publishing/private-history?site=default&collection=posts&id=${doc.id}` }
    }
    expect((await privatePublishingHistory(await privateRequest(false), 'default')).versions.length).toBeGreaterThanOrEqual(2)
    expect((await privatePublishingHistory(await privateRequest(true), 'default')).versions).toEqual([])
    const versions = await payload.findVersions({ collection: 'posts', req: await fixtureRequest(payload), where: { parent: { equals: doc.id } } })
    expect(versions.docs.every(version => version.version.audience === 'public')).toBe(true)
  } finally { await payload.delete({ collection: 'posts', id: doc.id, req: await fixtureRequest(payload) }) }
})

it('requires current document readership for review-task direct reads, lists and counts', async () => {
  const db = (payload.db as unknown as { client: D1Database }).client
  await db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('internal-reader','tasks:read')").run()
  const admin = await fixtureRequest(payload)
  Object.assign(admin.context, { [CMS_AUDIENCE]: 'intranet' })
  const document = await payload.create({ collection: 'posts', req: admin, data: { title: 'Private document task source', slug: 'private-document-task-source', audience: 'intranet', author: Number(admin.user!.id), _status: 'published' } })
  const task = await payload.create({ collection: 'review-tasks', req: await fixtureRequest(payload), data: { title: 'Restricted document discussion', documentType: 'posts', documentID: String(document.id), region: 'document', status: 'open', priority: 'normal' } })
  try {
    expect((await payload.findByID({ collection: 'review-tasks', id: task.id, req: await readerRequest(), depth: 0 })).id).toBe(task.id)
    await notify(await fixtureRequest(payload), { recipient: String(reader.id), task: String(task.id), kind: 'comment', message: 'Document discussion fixture', key: 'private_doc_notification_fixture' })
    expect((await payload.count({ collection: 'task-notifications', req: await readerRequest(), overrideAccess: false, where: { task: { equals: task.id } } })).totalDocs).toBe(1)
    const sharing = new PublishingSharing(await fixtureRequest(payload)), current = await sharing.read('default', 'posts', document.id)
    await sharing.save({ site: 'default', collection: 'posts', id: document.id, readership: 'restricted', people: [], groups: [],
      expectedRevision: current.revision, expectedAuthorityRevision: current.authorityRevision, key: 'restrict_review_doc_123456789' })
    await expect(payload.findByID({ collection: 'review-tasks', id: task.id, req: await readerRequest(), depth: 0 })).rejects.toThrow()
    expect((await payload.find({ collection: 'review-tasks', req: await readerRequest(), where: { id: { equals: task.id } }, depth: 0 })).docs).toEqual([])
    expect((await payload.count({ collection: 'review-tasks', req: await readerRequest(), where: { id: { equals: task.id } } })).totalDocs).toBe(0)
    expect((await payload.count({ collection: 'task-notifications', req: await readerRequest(), overrideAccess: false, where: { task: { equals: task.id } } })).totalDocs).toBe(0)
  } finally {
    // Tasks retain their activity history; this fixture must respect their
    // existing no-delete rule. Removing its document also removes read access.
    await payload.delete({ collection: 'posts', id: document.id, req: await fixtureRequest(payload) })
  }
})

it('keeps internal publishing and search available when public Posts, Pages and the website are disabled', async () => {
  const db = (payload.db as unknown as { client: D1Database }).client
  await db.batch([
    db.prepare("UPDATE vc_tenant_features SET available=0 WHERE feature IN('posts','pages')"),
    db.prepare("UPDATE vc_site_websites SET published=0 WHERE site_id='default'"),
  ])
  const req = await fixtureRequest(payload)
  Object.assign(req.context, { [CMS_AUDIENCE]: 'intranet' })
  const post = await payload.create({ collection: 'posts', req, data: {
    title: 'Internal independent publication', slug: 'internal-independent', author: Number(req.user!.id), audience: 'intranet', _status: 'published',
  } })
  expect((await payload.findByID({ collection: 'posts', id: post.id, req: await readerRequest(), depth: 0 })).title).toBe('Internal independent publication')
  expect((await payload.find({ collection: 'search', req: await readerRequest(), depth: 0 })).totalDocs).toBe(1)
})
