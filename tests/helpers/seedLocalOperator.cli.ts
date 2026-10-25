import path from 'node:path'
import { getPayload } from 'payload'
import { bootstrapFixtureOperator } from './native-authority'

const state = process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (
  !state ||
  !path.isAbsolute(state) ||
  process.env.DESIGN_PRODUCTION_DEPLOY ||
  process.env.DESIGN_PRODUCTION_MIGRATE
)
  throw Error('A fresh local database is required for the fictional operator.')
const { default: config } = await import('../../src/payload.config')
await bootstrapFixtureOperator(await getPayload({ config }))
console.log('Fresh local operator initialized; no workflow data seeded.')
process.exit(0)
