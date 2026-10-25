import path from 'node:path'
import os from 'node:os'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-d1-sqlite'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { activitySchemaV1 } from '../../src/crm/activity-schema-v1'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { emailSchemaV1 } from '../../src/crm/email-schema-v1'

const state = process.env.E2E_TEST_PERSIST_PATH
if (
  !state ||
  path.resolve(state) !== path.resolve(os.tmpdir(), 'vorticause-crm-expansion-browser') ||
  process.env.DESIGN_PRODUCTION_DEPLOY ||
  process.env.DESIGN_PRODUCTION_MIGRATE
)
  throw new Error('CRM expansion fixtures require their explicit isolated local database.')
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config })
const count = await payload.db.drizzle.get<{ n: number }>(
  sql.raw('SELECT count(*) AS n FROM users'),
)
if (!count?.n)
  await payload.create({
    collection: 'users',
    data: {
      username: 'crm-expansion-review',
      email: 'dev@payloadcms.com',
      password: 'test',
      role: 'administrator',
    },
  })
const session = await payload.login({
  collection: 'users',
  data: { email: 'dev@payloadcms.com', password: 'test' },
})
if (!session.user) throw new Error('Could not authenticate the isolated test operator.')
for (const statement of [
  ...organizationSchema,
  ...defaultOrganizationSeed,
  ...contactSchemaV1,
  ...financeSchemaV1,
])
  await payload.db.drizzle.run(sql.raw(statement))
const fundColumns = await payload.db.drizzle.all<{ name: string }>(
  sql.raw('PRAGMA table_info(vc_crm_funds)'),
)
for (const statement of [
  ...householdSchemaV1,
  ...fundraisingSchemaV1,
  ...activitySchemaV1,
  ...crmJobSchemaV1,
  ...commitmentSchemaV1,
  ...membershipSchemaV1,
  ...opportunitySchemaV1,
  ...volunteerSchemaV1,
  ...correspondenceSchemaV1,
  ...emailSchemaV1,
]) {
  const column = /^ALTER TABLE vc_crm_funds ADD COLUMN (\w+)/.exec(statement)?.[1]
  if (column && fundColumns.some((c) => c.name === column)) continue
  await payload.db.drizzle.run(sql.raw(statement))
}
console.log('Isolated CRM expansion schema and authenticated fictional operator are ready.')
process.exit(0)
