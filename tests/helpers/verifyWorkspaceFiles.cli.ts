import { getPayload, createLocalReq, type PayloadRequest } from 'payload'
import path from 'node:path'
import { cmsSiteContext } from '../../src/organizations/cms-scope'
import { workspaceFileEndpoints } from '../../src/review/workspace-files'
const state = process.env.E2E_TEST_PERSIST_PATH || process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (
  !state ||
  !path.resolve(state).startsWith(path.resolve('.wrangler') + path.sep) ||
  process.env.DESIGN_PRODUCTION_DEPLOY ||
  process.env.DESIGN_PRODUCTION_MIGRATE
)
  throw new Error('Scoped file verification requires an isolated local .wrangler database.')
process.env.DESIGN_CORE_TEST_PERSIST_PATH = state
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config })
const admin = (
  await payload.find({
    collection: 'users',
    where: { email: { equals: 'dev@payloadcms.com' } },
    limit: 1,
  })
).docs[0]
const binding = payload.db.drizzle.$client as D1Database
if (
  !admin?.platformOperator ||
  !(await binding
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='task_attachments_vc_mutation_insert'",
    )
    .first())
)
  throw new Error('Seed the fictional operator and apply the local tracked migrations first.')
const request = async (body?: object, file?: Uint8Array, id?: number) => {
  const req = await createLocalReq(
    { user: { ...admin, collection: 'users' }, context: cmsSiteContext('default') },
    payload,
  )
  req.routeParams = { id: String(id || '') }
  req.json = async () => body
  if (file) Object.defineProperty(req, 'body', { value: new Blob([file]).stream() })
  return req
}
const board = await payload.create({
  collection: 'task-boards',
  req: await request(),
  data: { name: 'Fictional guarded file review', visibility: 'private', owner: admin.id },
})
const task = await payload.create({
  collection: 'review-tasks',
  req: await request(),
  data: {
    title: 'Fictional guarded file review',
    initialBoard: board.id,
    status: 'open',
    priority: 'normal',
  },
})
const objects = new Map<string, Uint8Array>()
const storage = {
  async put(key: string, bytes: Uint8Array) {
    if (objects.has(key)) return null
    objects.set(key, bytes)
    return { etag: 'fictional' }
  },
  async get(key: string) {
    const bytes = objects.get(key)
    return bytes ? { body: new Blob([bytes]).stream(), size: bytes.length } : null
  },
  async delete(key: string) {
    objects.delete(key)
  },
} as unknown as R2Bucket
const endpoints = workspaceFileEndpoints(storage)
const run = (method: string, path: string, req: PayloadRequest) =>
  endpoints.find((endpoint) => endpoint.method === method && endpoint.path === path)!.handler(req)
const bytes = new TextEncoder().encode('Fictional private file')
const staged = await run(
  'post',
  '/task-workspace/files/stage',
  await request({ task: task.id, filename: 'review.txt', size: bytes.length }),
)
if (!staged.ok) throw new Error(await staged.text())
const { id } = (await staged.json()) as { id: number }
const uploaded = await run(
  'put',
  '/task-workspace/files/:id/content',
  await request(undefined, bytes, id),
)
if (!uploaded.ok) throw new Error(await uploaded.text())
const internal = await payload.findByID({
  collection: 'task-attachments',
  id,
  req: await request(),
  overrideAccess: true,
  depth: 0,
})
if ('platformMutationProof' in internal)
  throw new Error('Commit proof leaked through a privileged read')
const downloaded = await run(
  'get',
  '/task-workspace/files/:id/content',
  await request(undefined, undefined, id),
)
if ((await downloaded.text()) !== 'Fictional private file') throw new Error('Private bytes changed')
const removed = await run(
  'delete',
  '/task-workspace/files/:id',
  await request(undefined, undefined, id),
)
if (!removed.ok || objects.size) throw new Error('Private cleanup failed')
console.log(
  JSON.stringify({
    scopedNativeFileStageUploadDownloadDelete: true,
    privilegedProofRedaction: true,
  }),
)
process.exit(0)
