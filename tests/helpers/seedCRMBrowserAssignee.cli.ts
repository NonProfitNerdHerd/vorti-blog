import path from 'node:path'
import { getPayload } from 'payload'
import { createChapterUser, fixtureRequest } from './native-authority'

const state = process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (!state || !path.isAbsolute(state) || process.env.DESIGN_PRODUCTION_DEPLOY || process.env.DESIGN_PRODUCTION_MIGRATE)
  throw Error('The fictional CRM assignee requires explicit local persistence.')
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config })
const existing = await payload.find({ collection: 'users', req: await fixtureRequest(payload),
  where: { username: { equals: 'crm-followup-assignee' } }, depth: 0, limit: 1 })
if (existing.totalDocs !== 0) throw Error('Use a fresh browser fixture; the assignee already exists.')
await createChapterUser(payload, 'editor', { collection: 'users', req: await fixtureRequest(payload),
  data: { username: 'crm-followup-assignee', email: 'crm-followup-assignee@example.invalid',
    password: 'local-followup-only-password', role: 'editor' } })
console.log('Fictional follow-up assignee initialized with explicit chapter editor access.')
process.exit(0)
