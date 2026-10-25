import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { getPayload, createLocalReq, type PayloadRequest } from 'payload'
import { OrganizationRepository } from '../../src/organizations/repository'
import { cmsSiteContext, cmsScope } from '../../src/organizations/cms-scope'

const state = process.env.E2E_TEST_PERSIST_PATH
if (
  !state ||
  !path.resolve(state).startsWith(path.resolve('.wrangler') + path.sep) ||
  process.env.DESIGN_PRODUCTION_DEPLOY ||
  process.env.DESIGN_PRODUCTION_MIGRATE
)
  throw new Error('Tenant CMS verification requires an isolated local database.')
process.env.DESIGN_CORE_TEST_PERSIST_PATH = state
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config }),
  db = payload.db.drizzle.$client as D1Database
const admin = (
  await payload.find({
    collection: 'users',
    depth: 0,
    limit: 1,
    where: { email: { equals: 'dev@payloadcms.com' } },
  })
).docs[0]
assert(admin?.platformOperator, 'Seed and migrate the isolated workspace first.')
const stamp = Date.now().toString(36),
  repository = new OrganizationRepository(db, Number(admin.id))
const rootA = await repository.createOrganization({
  name: `Fictional CMS A ${stamp}`,
  siteName: 'Fictional A',
  operationKey: `cms_a_${stamp}_organization`,
})
const rootB = await repository.createOrganization({
  name: `Fictional CMS B ${stamp}`,
  siteName: 'Fictional B',
  operationKey: `cms_b_${stamp}_organization`,
})
const a = String(rootA.site),
  b = String(rootB.site)
async function req(user: typeof admin, site: string): Promise<PayloadRequest> {
  return createLocalReq({ user, context: cmsSiteContext(site) }, payload)
}
const userA = await payload.create({
  collection: 'users',
  req: await req(admin, a),
  data: {
    email: `cms-a-${stamp}@example.invalid`,
    username: `cms-a-${stamp}`,
    password: 'local-tenant-test-only',
    role: 'editor',
  },
})
const userB = await payload.create({
  collection: 'users',
  req: await req(admin, b),
  data: {
    email: `cms-b-${stamp}@example.invalid`,
    username: `cms-b-${stamp}`,
    password: 'local-tenant-test-only',
    role: 'administrator',
  },
})
assert.equal(
  userB.platformOperator,
  false,
  'A site administrator must not become an installation operator.',
)
// The publishing fixture needs explicit chapter capabilities; its global
// editor role does not grant organization-level content or workspace editing.
const membershipSite = await db.prepare('SELECT revision FROM vc_sites WHERE id=?').bind(a).first<{ revision: number }>()
await repository.setMembership({ site: a, user: userA.id, role: 'administrator', active: true,
  expectedRevision: membershipSite!.revision, operationKey: crypto.randomUUID() })
const measured = await req(userA, a)
let initializationQueries = 0
measured.payload = { db: { client: { prepare(sql: string) { initializationQueries++; return db.prepare(sql) } } } } as unknown as PayloadRequest['payload']
const parallelScopes = await Promise.all(Array.from({ length: 20 }, () => cmsScope(measured, 'read')))
assert(parallelScopes.every(scope => scope.site === a))
assert(initializationQueries < 25, 'Parallel native permission checks must share one bounded authority load.')
const richText = (text: string) => ({
  root: {
    type: 'root',
    version: 1,
    direction: null as null,
    format: '' as const,
    indent: 0,
    children: [
      {
        type: 'paragraph',
        version: 1,
        direction: null as null,
        format: '' as const,
        indent: 0,
        children: [
          { type: 'text', text, version: 1, detail: 0, format: 0, mode: 'normal', style: '' },
        ],
      },
    ],
  },
})
const slug = `same-route-${stamp}`
const postA = await payload.create({
  collection: 'posts',
  req: await req(userA, a),
  data: {
    title: 'Fictional A public',
    slug,
    content: richText('Fictional A body'),
    _status: 'published',
  } as never,
})
const postB = await payload.create({
  collection: 'posts',
  req: await req(userB, b),
  data: {
    title: 'Fictional B private',
    slug,
    content: richText('Fictional B body'),
    _status: 'draft',
  } as never,
  draft: true,
})
const draftA = await payload.create({
  collection: 'posts',
  req: await req(userA, a),
  data: {
    title: 'Fictional A draft',
    slug: `${slug}-draft`,
    content: richText('Fictional draft'),
    _status: 'draft',
  } as never,
  draft: true,
})
assert.equal(postA.platformSite, a)
assert.equal(postB.platformSite, b)
const allA = await payload.find({
  collection: 'posts',
  req: await req(userA, a),
  pagination: false,
  depth: 0,
  overrideAccess: true,
  draft: true,
})
assert.deepEqual(new Set(allA.docs.map((doc) => doc.id)), new Set([postA.id, draftA.id]))
assert.equal(
  (await payload.count({ collection: 'posts', req: await req(userA, a), overrideAccess: true }))
    .totalDocs,
  2,
)
await assert.rejects(
  payload.findByID({
    collection: 'posts',
    id: postB.id,
    req: await req(userA, a),
    overrideAccess: true,
  }),
)
await assert.rejects(
  payload.find({ collection: 'posts', req: await req(userA, b), overrideAccess: true }),
)
await assert.rejects(
  payload.update({
    collection: 'posts',
    id: postA.id,
    req: await req(userA, a),
    data: { platformSite: b } as never,
    overrideAccess: true,
  }),
)
await assert.rejects(
  payload.update({
    collection: 'posts',
    id: postA.id,
    req: await req(userA, a),
    data: { platformWriteEpoch: 999 } as never,
    overrideAccess: true,
  }),
)
const categoryB = await payload.create({
  collection: 'categories',
  req: await req(userB, b),
  data: { name: 'Fictional foreign taxonomy', slug: `foreign-${stamp}` } as never,
})
await assert.rejects(
  payload.update({
    collection: 'posts',
    id: postA.id,
    req: await req(userA, a),
    data: { categories: [categoryB.id] },
    overrideAccess: true,
  }),
)
await assert.rejects(
  payload.update({
    collection: 'posts',
    id: postA.id,
    req: await req(userA, a),
    data: { author: userB.id },
    overrideAccess: true,
  }),
)
const accounts = await payload.find({
  collection: 'users',
  req: await req(userA, a),
  depth: 0,
  pagination: false,
  overrideAccess: true,
})
assert(accounts.docs.some((doc) => doc.id === userA.id))
assert(
  !accounts.docs.some((doc) => doc.id === userB.id),
  'Directory must not expose another root through native reads.',
)
assert(
  !accounts.docs.some((doc) => 'siteDirectory' in doc),
  'Directory memberships must not be populated in responses.',
)
await assert.rejects(
  payload.update({
    collection: 'users',
    id: userA.id,
    req: await req(userB, b),
    data: { displayName: 'Unauthorized cross-root change' },
    overrideAccess: true,
  }),
)
const forged = await payload.update({
  collection: 'users',
  id: userA.id,
  req: await req(userA, a),
  data: { platformOperator: true } as never,
})
assert.equal(forged.platformOperator, false)
assert.deepEqual(forged.platformAuthority, { actor: userA.id }, 'Native account responses must not expose authority roots or matrices.')
assert.equal(Object.getOwnPropertySymbols(forged).length, 0, 'Account documents must remain serializable across the admin boundary.')
const projectA = await payload.create({
  collection: 'task-projects',
  req: await req(userA, a),
  data: { name: 'Fictional A team', visibility: 'team' },
})
const projectB = await payload.create({
  collection: 'task-projects',
  req: await req(userB, b),
  data: { name: 'Fictional B team', visibility: 'team' },
})
assert.equal(projectA.platformSite, a)
assert.equal(projectB.platformSite, b)
const boardA = await payload.create({
  collection: 'task-boards',
  req: await req(userA, a),
  data: {
    name: 'Fictional A board',
    project: projectA.id,
    inheritProject: true,
    visibility: 'team',
  } as never,
})
const boardB = await payload.create({
  collection: 'task-boards',
  req: await req(userB, b),
  data: {
    name: 'Fictional B board',
    project: projectB.id,
    inheritProject: true,
    visibility: 'team',
  } as never,
})
await assert.rejects(
  payload.findByID({
    collection: 'task-projects',
    id: projectA.id,
    req: await req(userB, b),
    overrideAccess: true,
  }),
)
await assert.rejects(
  payload.findByID({
    collection: 'task-boards',
    id: boardB.id,
    req: await req(userA, a),
    overrideAccess: true,
  }),
)
assert.equal(
  (
    await payload.count({
      collection: 'task-projects',
      req: await req(userA, a),
      overrideAccess: true,
      where: { id: { equals: projectB.id } },
    })
  ).totalDocs,
  0,
)
const taskA = await payload.create({
  collection: 'review-tasks',
  req: await req(userA, a),
  data: { title: 'Fictional A board task', initialBoard: boardA.id } as never,
})
const taskB = await payload.create({
  collection: 'review-tasks',
  req: await req(userB, b),
  data: { title: 'Fictional B board task', initialBoard: boardB.id } as never,
})
const documentTask = await payload.create({
  collection: 'review-tasks',
  req: await req(userA, a),
  data: {
    title: 'Fictional A document task',
    documentType: 'posts',
    documentID: String(postA.id),
  } as never,
})
assert.equal(documentTask.documentSite, a)
await assert.rejects(
  payload.findByID({
    collection: 'review-tasks',
    id: taskA.id,
    req: await req(userB, b),
    overrideAccess: true,
  }),
)
assert.equal(
  (
    await payload.count({
      collection: 'review-tasks',
      req: await req(userA, a),
      overrideAccess: true,
      where: { id: { equals: taskB.id } },
    })
  ).totalDocs,
  0,
)
assert.equal(
  (
    await payload.count({
      collection: 'review-tasks',
      req: await req(userB, b),
      overrideAccess: true,
      where: { id: { equals: documentTask.id } },
    })
  ).totalDocs,
  0,
)
const formA = await payload.create({
  collection: 'forms',
  req: await req(admin, a),
  draft: true,
  data: { title: 'Fictional A form', slug: `same-form-${stamp}` },
})
const formB = await payload.create({
  collection: 'forms',
  req: await req(userB, b),
  draft: true,
  data: { title: 'Fictional B form', slug: `same-form-${stamp}` },
})
assert.equal(formA.site, a)
assert.equal(formB.site, b)
await assert.rejects(
  payload.findByID({
    collection: 'forms',
    id: formA.id,
    req: await req(userB, b),
    draft: true,
    overrideAccess: true,
  }),
)
assert.equal(
  (await payload.count({ collection: 'forms', req: await req(userB, b), overrideAccess: true }))
    .totalDocs,
  1,
)
// Publishing content does not require granting Forms design. Keep this
// negative case explicit after provisioning chapter publishing capabilities.
const formsRestrictionSite = await db.prepare('SELECT revision FROM vc_sites WHERE id=?').bind(a).first<{ revision: number }>()
await repository.setRestrictions({ site: a, user: userA.id,
  denied: [{ category: 'forms', operation: 'edit' }],
  expectedRevision: formsRestrictionSite!.revision, operationKey: crypto.randomUUID() })
await assert.rejects(
  payload.create({
    collection: 'forms',
    req: await req(userA, a),
    draft: true,
    data: { title: 'No form design permission' },
  }),
)
await assert.rejects(
  payload.update({
    collection: 'forms',
    req: await req(userB, b),
    id: formB.id,
    draft: true,
    data: { site: a },
  }),
)
const versionsB = await payload.findVersions({
  collection: 'posts',
  req: await req(userB, b),
  where: { parent: { equals: postB.id } },
  depth: 0,
  overrideAccess: true,
})
assert(versionsB.docs.length > 0)
await assert.rejects(
  payload.findVersionByID({
    collection: 'posts',
    id: versionsB.docs[0].id,
    req: await req(userA, a),
    overrideAccess: true,
  }),
)
await assert.rejects(
  payload.restoreVersion({
    collection: 'posts',
    id: versionsB.docs[0].id,
    req: await req(userA, a),
    overrideAccess: true,
  }),
)
const versionsA = await payload.findVersions({
  collection: 'posts',
  req: await req(userA, a),
  depth: 0,
  overrideAccess: true,
})
assert(versionsA.docs.every((row) => row.version.platformSite === a))
const rootOnly = await payload.find({
  collection: 'posts',
  depth: 0,
  pagination: false,
  overrideAccess: true,
})
assert(
  !rootOnly.docs.some((doc) => doc.id === postA.id || doc.id === postB.id),
  'Anonymous/default rendering must not cross site boundaries.',
)
const searchA = await payload.find({
  collection: 'search',
  req: await req(userA, a),
  depth: 0,
  overrideAccess: true,
})
assert(
  searchA.docs.some(
    (doc) =>
      doc.doc &&
      String(typeof doc.doc.value === 'object' ? doc.doc.value.id : doc.doc.value) ===
        String(postA.id),
  ),
  'Published search projection must keep working.',
)
await assert.rejects(
  payload.updateGlobal({
    slug: 'site-settings',
    req: await req(userB, b),
    data: { title: 'Must not overwrite root' } as never,
    overrideAccess: true,
  }),
)
await assert.rejects(
  payload.updateGlobal({
    slug: 'system-settings',
    req: await req(userB, b),
    data: { categoriesEnabled: false },
    overrideAccess: true,
  }),
)
// Revoke after a read has been authorized, but before native SQL returns the result.
const staleRead = await req(userA, a)
await cmsScope(staleRead, 'read')
await db
  .prepare(
    "INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,?,'content','read')",
  )
  .bind(a, userA.id)
  .run()
await assert.rejects(
  payload.find({ collection: 'posts', req: staleRead, depth: 0, overrideAccess: true }),
)
await db
  .prepare(
    "DELETE FROM vc_member_restrictions WHERE site_id=? AND user_id=? AND category='content' AND operation='read'",
  )
  .bind(a, userA.id)
  .run()
// Revoke after collection hooks finish, immediately before the database write. The SQL trigger
// fences this race even though the request already passed access and validation.
const epochField = payload.collections.posts.config.fields.find(
  (field) => 'name' in field && field.name === 'platformWriteEpoch',
)!
assert('hooks' in epochField)
const oldHooks = epochField.hooks
let revoke = true
epochField.hooks = {
  ...oldHooks,
  beforeChange: [
    async ({ value }) => {
      if (revoke) {
        revoke = false
        await db
          .prepare(
            "INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,?,'content','edit')",
          )
          .bind(a, userA.id)
          .run()
      }
      return value
    },
  ],
}
try {
  await assert.rejects(
    payload.update({
      collection: 'posts',
      id: postA.id,
      req: await req(userA, a),
      data: { title: 'Must roll back after revocation' },
      overrideAccess: true,
    }),
  )
} finally {
  epochField.hooks = oldHooks
}
assert.equal(
  (
    await payload.findByID({
      collection: 'posts',
      id: postA.id,
      req: await req(admin, a),
      depth: 0,
    })
  ).title,
  'Fictional A public',
)
await db
  .prepare(
    "DELETE FROM vc_member_restrictions WHERE site_id=? AND user_id=? AND category='content' AND operation='edit'",
  )
  .bind(a, userA.id)
  .run()
await assert.rejects(db.prepare('DELETE FROM posts WHERE id=?').bind(postA.id).run())
await payload.delete({
  collection: 'posts',
  id: draftA.id,
  req: await req(userA, a),
  overrideAccess: true,
})
assert.equal((await payload.count({ collection: 'posts', req: await req(userA, a) })).totalDocs, 1)
await writeFile(
  path.join(state, 'tenant-http-fixture.json'),
  JSON.stringify({
    a,
    b,
    userA: { username: userA.username, password: 'local-tenant-test-only' },
    userB: { username: userB.username, password: 'local-tenant-test-only' },
    postA: postA.id,
    postB: postB.id,
    formA: formA.id,
    formB: formB.id,
    taskA: taskA.id,
    taskB: taskB.id,
    documentTask: documentTask.id,
    projectA: projectA.id,
    boardA: boardA.id,
  }),
)
console.log(
  JSON.stringify({
    tenantCMSVerified: true,
    formsAndTeamWorkspaceScoped: true,
    nativeListCountIDVersionsRestore: true,
    crossRootAssignmentsRejected: true,
    accountDirectoryScoped: true,
    settingsProtected: true,
    readAndWriteRevocationFenced: true,
    preservedPrivateDrafts: true,
  }),
)
process.exit(0)
