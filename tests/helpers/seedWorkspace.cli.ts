import { getPayload } from 'payload'
import fs from 'node:fs'
import path from 'node:path'
const state = process.env.E2E_TEST_PERSIST_PATH
if (state && fs.existsSync(path.join(state, 'd1')))
  process.env.DESIGN_CORE_TEST_PERSIST_PATH = state
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config })
const existing = await payload.find({
  collection: 'users',
  depth: 0,
  limit: 1,
  where: { email: { equals: 'dev@payloadcms.com' } },
})
if (!existing.docs[0])
  await payload.create({
    collection: 'users',
    data: {
      username: 'workspace-admin',
      email: 'dev@payloadcms.com',
      password: 'test',
      role: 'administrator',
    },
  })
process.exit(0)
