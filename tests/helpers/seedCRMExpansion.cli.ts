import { correspondenceBatchSchemaV1 } from '../../src/crm/correspondence-batch-schema-v1'
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
import { attachmentSchemaV1 } from '../../src/crm/attachment-schema-v1'
import { timelineIndexesV1 } from '../../src/crm/timeline-indexes-v1'
import { applyCRMTaskSchemaV1 } from '../../src/crm/task-schema-v1'
import { applyImportSchemaV1 } from '../../src/crm/import-schema-v1'
import { importExportSchemaV1 } from '../../src/crm/import-export-schema-v1'
import { OrganizationRepository } from '../../src/organizations/repository'
import {
  workspaceProjectionSchemaV1,
  workspaceProjectionBackfillV1,
} from '../../src/organizations/workspace-projection-v1'

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
  ...attachmentSchemaV1,
  ...timelineIndexesV1,
  ...correspondenceBatchSchemaV1,
]) {
  const column = /^ALTER TABLE vc_crm_funds ADD COLUMN (\w+)/.exec(statement)?.[1]
  if (column && fundColumns.some((c) => c.name === column)) continue
  await payload.db.drizzle.run(sql.raw(statement))
}
await applyImportSchemaV1(
  async (statement) => payload.db.drizzle.run(sql.raw(statement)),
  async () =>
    payload.db.drizzle.all<{ name: string }>(
      sql.raw('PRAGMA table_info(vc_crm_source_identifiers)'),
    ),
)
for (const statement of importExportSchemaV1) await payload.db.drizzle.run(sql.raw(statement))
// Payload schema push models joins as tables. In this explicitly isolated fixture
// only, replace empty derived tables with the migration's read-only views.
for (const table of ['vc_crm_task_contexts', 'vc_crm_task_constituents']) {
  const physical = await payload.db.drizzle.all<{ name: string }>(
    sql.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`),
  )
  if (!physical.length) continue
  const rows = await payload.db.drizzle.all<{ n: number }>(
    sql.raw(`SELECT count(*) AS n FROM ${table}`),
  )
  if (rows[0]?.n !== 0) throw new Error('Refusing to replace a populated local CRM access table.')
  await payload.db.drizzle.run(sql.raw(`DROP TABLE ${table}`))
}
for (const statement of [...workspaceProjectionSchemaV1, ...workspaceProjectionBackfillV1])
  await payload.db.drizzle.run(sql.raw(statement))
await applyCRMTaskSchemaV1(
  async (statement) => payload.db.drizzle.run(sql.raw(statement)),
  async (table = 'review_tasks') =>
    payload.db.drizzle.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`)),
  async () =>
    payload.db.drizzle.all<{ name: string }>(
      sql.raw("SELECT name FROM sqlite_master WHERE type='table'"),
    ),
)
const existingAssignee = await payload.find({
  collection: 'users',
  where: { username: { equals: 'crm-followup-assignee' } },
  limit: 1,
  depth: 0,
})
const assignee =
  existingAssignee.docs[0] ||
  (await payload.create({
    collection: 'users',
    data: {
      username: 'crm-followup-assignee',
      email: 'crm-followup-assignee@example.invalid',
      password: 'local-followup-only-password',
      role: 'editor',
    },
  }))
const membership = await payload.db.drizzle.all<{ role: string; active: number }>(
  sql.raw(
    `SELECT role,active FROM vc_site_memberships WHERE site_id='default' AND user_id=${Number(assignee.id)}`,
  ),
)
if (membership[0]?.role !== 'editor' || membership[0]?.active !== 1) {
  const revision = await payload.db.drizzle.all<{ revision: number }>(
    sql.raw("SELECT revision FROM vc_sites WHERE id='default'"),
  )
  await new OrganizationRepository(
    (payload.db as unknown as { client: D1Database }).client,
    session.user.id,
  ).setMembership({
    site: 'default',
    user: assignee.id,
    role: 'editor',
    active: true,
    expectedRevision: revision[0].revision,
    operationKey: crypto.randomUUID(),
  })
}
console.log('Isolated CRM expansion schema and authenticated fictional operator are ready.')
process.exit(0)
