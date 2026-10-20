import path from 'node:path'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-d1-sqlite'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'

const state = process.env.E2E_TEST_PERSIST_PATH
const allowed = path.resolve('.wrangler') + path.sep
if (
  !state ||
  !path.resolve(state).startsWith(allowed) ||
  process.env.DESIGN_PRODUCTION_DEPLOY ||
  process.env.DESIGN_PRODUCTION_MIGRATE
)
  throw new Error('CRM fixtures require an explicit isolated .wrangler test database.')
process.env.DESIGN_CORE_TEST_PERSIST_PATH = state
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config })
const reader = await payload.find({
  collection: 'users',
  limit: 1,
  where: { email: { equals: 'crm-reader@example.invalid' } },
})
if (!reader.docs.length)
  await payload.create({
    collection: 'users',
    data: {
      username: 'crm-reader',
      email: 'crm-reader@example.invalid',
      password: 'crm-local-review-only',
      role: 'editor',
    },
  })
for (const statement of [...organizationSchema, ...defaultOrganizationSeed, ...contactSchemaV1])
  await payload.db.drizzle.run(sql.raw(statement))
console.log('Fictional CRM review accounts and isolated schema ready.')
process.exit(0)
