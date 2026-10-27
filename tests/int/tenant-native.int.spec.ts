import { beforeAll, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { fixtureOperator, createChapterUser } from '../helpers/native-authority'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { cmsSiteContext } from '../../src/organizations/cms-scope'
import type { User } from '../../src/payload-types'
import { InvitationRepository } from '../../src/organizations/invitations'
import { ContactRepository } from '../../src/crm/contacts'
import { CRMTasks } from '../../src/crm/tasks'

let payload: Payload, admin: User, member: User, outsider: User, db: D1Database
const req = (user: User) =>
  createLocalReq(
    { user: { ...user, collection: 'users' }, context: cmsSiteContext('default') },
    payload,
  )
beforeAll(async () => {
  payload = await getPayload({ config })
  db = (payload.db as unknown as { client: D1Database }).client
  admin = await fixtureOperator(payload)
  member = await createChapterUser(payload, 'editor', {
    collection: 'users',
    data: {
      email: 'tenant-member@example.invalid',
      username: 'tenant-member',
      password: 'local-test-password',
      role: 'editor',
    },
  })
  outsider = await createChapterUser(payload, 'editor', {
    collection: 'users',
    data: {
      email: 'tenant-outsider@example.invalid',
      username: 'tenant-outsider',
      password: 'local-test-password',
      role: 'editor',
    },
  })
  await bootstrapTenant(db, { tenant: 'default', site: 'default', administratorEmail: admin.email })
  await db.batch([
    db
      .prepare("INSERT INTO vc_tenant_memberships(tenant_id,user_id,active) VALUES('default',?,1)")
      .bind(member.id),
    db.prepare(
      "INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('task-member','default','Task member')",
    ),
    ...['read', 'create', 'edit', 'delete', 'comment', 'assign', 'manage-projects', 'share'].map(
      (action) =>
        db
          .prepare(
            "INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('task-member',?)",
          )
          .bind(`tasks:${action}`),
    ),
    db
      .prepare(
        "INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('member-tasks','default',?,'task-member','default',0)",
      )
      .bind(member.id),
  ])
  await activateTenantAuthority(db, 'default')
})
it('retains native personal Task creation and editing, audits tenant administrator reads and denies a legacy-only account', async () => {
  const task = await payload.create({
    collection: 'review-tasks',
    req: await req(member),
    overrideAccess: false,
    depth: 0,
    data: { title: 'Personal tenant task', status: 'open', priority: 'normal' },
  })
  expect(task.creationTenant).toBe('default')
  const edited = await payload.update({
    collection: 'review-tasks',
    id: task.id,
    req: await req(member),
    overrideAccess: false,
    depth: 0,
    data: { title: 'Edited tenant task' },
  })
  expect(edited.title).toBe('Edited tenant task')
  const directory = await payload.find({
    collection: 'users',
    req: await req(member),
    overrideAccess: false,
    depth: 0,
    limit: 100,
  })
  expect(directory.docs.map((user) => user.id)).toContain(admin.id)
  expect(directory.docs.map((user) => user.id)).not.toContain(outsider.id)
  expect(
    (
      await payload.findByID({
        collection: 'review-tasks',
        id: task.id,
        req: await req(admin),
        overrideAccess: false,
        depth: 0,
      })
    ).title,
  ).toBe('Edited tenant task')
  await expect(
    payload.findByID({
      collection: 'review-tasks',
      id: task.id,
      req: await req(outsider),
      overrideAccess: false,
      depth: 0,
    }),
  ).rejects.toThrow()
  expect(
    Number(
      (
        await db
          .prepare(
            "SELECT count(*) n FROM vc_platform_audit WHERE action='tenant-administrator.read'",
          )
          .first<{ n: number }>()
      )?.n,
    ),
  ).toBeGreaterThan(0)
  await db
    .prepare(
      "UPDATE vc_tenant_features SET available=0 WHERE tenant_id='default' AND feature='tasks'",
    )
    .run()
  await expect(
    payload.findByID({
      collection: 'review-tasks',
      id: task.id,
      req: await req(admin),
      overrideAccess: false,
      depth: 0,
    }),
  ).rejects.toThrow()
  expect(
    await db.prepare('SELECT title FROM review_tasks WHERE id=?').bind(task.id).first(),
  ).toMatchObject({ title: 'Edited tenant task' })
}, 120000)

it('uses fine Page permissions for native writes, history and counts while retaining disabled content', async () => {
  await db.batch([
    db.prepare("INSERT INTO vc_tenant_roles(id,tenant_id,name) VALUES('page-member','default','Page author')"),
    ...['read-published', 'read-history', 'create', 'edit'].map(action => db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('page-member',?)").bind(`pages:${action}`)),
    db.prepare("INSERT INTO vc_tenant_assignments(id,tenant_id,user_id,role_id,site_id,descendants) VALUES('member-pages','default',?,'page-member','default',0)").bind(member.id),
  ])
  const page = await payload.create({collection: 'pages', req: await req(member), overrideAccess: false, draft: true, data: {title: 'Scoped private draft', slug: 'scoped-private-draft', contentLayout: {version: 1, nodes: []}}})
  expect((await payload.findByID({collection: 'pages', id: page.id, req: await req(member), overrideAccess: false})).title).toBe(page.title)
  await expect(payload.update({collection: 'pages', id: page.id, req: await req(member), overrideAccess: false, data: {_status: 'published'}})).rejects.toThrow()
  await expect(payload.findByID({collection: 'pages', id: page.id, req: await req(outsider), overrideAccess: true})).rejects.toThrow()
  await db.prepare("UPDATE vc_tenant_features SET available=0 WHERE tenant_id='default' AND feature='pages'").run()
  await expect(payload.findByID({collection: 'pages', id: page.id, req: await req(admin), overrideAccess: true})).rejects.toThrow()
  await expect(payload.count({collection: 'pages', req: await req(member), overrideAccess: true})).rejects.toThrow()
  expect(await db.prepare('SELECT id FROM pages WHERE id=?').bind(page.id).first()).toBeTruthy()
  await db.prepare("UPDATE vc_tenant_features SET available=1 WHERE tenant_id='default' AND feature='pages'").run()
}, 120000)

it('blocks anonymous primary-site collection reads during unpublication while retaining staff access', async () => {
  await db.prepare("UPDATE vc_site_websites SET published=0 WHERE site_id='default'").run()
  try {
    const anonymous = await createLocalReq({context:cmsSiteContext('default')},payload)
    await expect(payload.find({collection:'pages',req:anonymous,overrideAccess:false})).rejects.toThrow()
    expect((await payload.find({collection:'pages',req:await req(admin),overrideAccess:false})).docs.length).toBeGreaterThan(0)
  } finally {
    await db.prepare("UPDATE vc_site_websites SET published=1 WHERE site_id='default'").run()
  }
}, 120000)

it('filters disabled-origin board Tasks from tenant administrator lists and counts', async () => {
  await db.batch([
    db.prepare("UPDATE vc_tenant_features SET available=1 WHERE tenant_id='default' AND feature='tasks'"),
    db.prepare("INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) VALUES('feature-child','default','default','Feature child','feature-child','now','now')"),
    db.prepare("INSERT INTO vc_site_ancestry VALUES('feature-child','feature-child',0),('default','feature-child',1)"),
  ])
  const childRequest = () => createLocalReq({user: {...admin, collection: 'users'}, context: cmsSiteContext('feature-child')}, payload)
  const board = await payload.create({collection: 'task-boards', req: await childRequest(), overrideAccess: false, data: {name: 'Child private board', visibility: 'private', owner: admin.id}})
  const task = await payload.create({collection: 'review-tasks', req: await childRequest(), overrideAccess: false, data: {title: 'Child task feature boundary', status: 'open', priority: 'normal', initialBoard: board.id}})
  const count = () => payload.count({collection: 'review-tasks', req: undefined, user: admin, overrideAccess: false, where: {id: {equals: task.id}}})
  expect((await count()).totalDocs).toBe(1)
  await db.prepare("INSERT INTO vc_site_features(site_id,feature,value) VALUES('feature-child','tasks','disabled')").run()
  expect((await count()).totalDocs).toBe(0)
  expect((await payload.count({collection: 'task-boards', req: await req(admin), overrideAccess: false, where: {id: {equals: board.id}}})).totalDocs).toBe(0)
  await expect(payload.findByID({collection: 'review-tasks', id: task.id, req: await req(admin), overrideAccess: false})).rejects.toThrow()
  expect(await db.prepare('SELECT id FROM review_tasks WHERE id=?').bind(task.id).first()).toBeTruthy()
  await db.prepare("UPDATE vc_site_features SET value='inherit' WHERE site_id='feature-child' AND feature='tasks'").run()
  expect((await count()).totalDocs).toBe(1)
}, 120000)

it('offers tenant-only members as CRM follow-up assignees and removes them after permission revocation', async () => {
  await db.batch([
    db.prepare('DELETE FROM vc_site_memberships WHERE user_id=?').bind(member.id),
    ...['read', 'edit', 'read-identity', 'edit-identity', 'read-communications', 'edit-communications'].map(action => db.prepare("INSERT INTO vc_tenant_role_permissions(role_id,permission) VALUES('task-member',?)").bind(`crm:${action}`)),
  ])
  const contact = await new ContactRepository(db, admin.id).create({site: 'default', profile: {kind: 'person', firstName: 'Synthetic assignment'}, roles: ['donor'], operationKey: crypto.randomUUID()})
  const link = {type: 'contact' as const, id: String(contact.id)}
  const people = async () => new CRMTasks(db, await req(admin)).people('default', link)
  expect((await people()).docs.map(person => person.id)).toContain(member.id)
  await db.prepare("DELETE FROM vc_tenant_role_permissions WHERE role_id='task-member' AND permission='crm:edit-communications'").run()
  expect((await people()).docs.map(person => person.id)).not.toContain(member.id)
}, 120000)

it('redeems a new-account invitation through the actual handler and preserves single-use membership', async () => {
  const invitation = await new InvitationRepository(db).issue(
    admin.id,
    'default',
    'invited-native@example.invalid',
    crypto.randomUUID(),
  )
  const endpoint = payload.config.endpoints.find(
    (endpoint) => endpoint.path === '/tenant-invitations/accept' && endpoint.method === 'post',
  )!
  const request = () => {
    const http = new Request('http://localhost/api/tenant-invitations/accept', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitation.token, username: 'invited-native', password: 'synthetic-invitation-password' }),
    })
    return Object.assign(http, { payload, context: {}, user: null }) as unknown as Parameters<
      typeof endpoint.handler
    >[0]
  }
  const response = await endpoint.handler(request())
  expect(response.status, await response.text()).toBe(200)
  expect((await endpoint.handler(request())).status).toBe(403)
  const login = await payload.login({
    collection: 'users',
    data: { email: 'invited-native@example.invalid', password: 'synthetic-invitation-password' },
  })
  expect(login.user.email).toBe('invited-native@example.invalid')
  expect(
    await db
      .prepare('SELECT active FROM vc_tenant_memberships WHERE user_id=?')
      .bind(login.user.id)
      .first(),
  ).toMatchObject({ active: 1 })
}, 120000)
