import path from 'node:path'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { getPayload, createLocalReq } from 'payload'
import { sql } from '@payloadcms/db-d1-sqlite'
import * as foundation from '../../src/migrations/20261020_213000_organization_foundation'
import * as contacts from '../../src/migrations/20261020_222000_crm_contacts'
import * as restrictions from '../../src/migrations/20261020_233000_authority_restrictions'
import * as finance from '../../src/migrations/20261020_234000_crm_finance'
import { PLATFORM_MIGRATION } from '../../src/organizations/account-guards'

const state = process.env.E2E_TEST_PERSIST_PATH
if (
  !state ||
  !path.resolve(state).startsWith(path.resolve('.wrangler') + path.sep) ||
  process.env.DESIGN_PRODUCTION_DEPLOY ||
  process.env.DESIGN_PRODUCTION_MIGRATE
)
  throw new Error('Migration verification requires an isolated local .wrangler database.')
process.env.DESIGN_CORE_TEST_PERSIST_PATH = state
process.env.PAYLOAD_MIGRATING = 'true'
const prompts = readdirSync('node_modules/.pnpm').find((name) => name.startsWith('prompts@'))
if (prompts)
  createRequire(import.meta.url)(
    path.resolve('node_modules/.pnpm', prompts, 'node_modules/prompts'),
  ).override({ confirm: true })
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config })
const admin = (
  await payload.find({
    collection: 'users',
    limit: 1,
    where: { email: { equals: 'dev@payloadcms.com' } },
  })
).docs[0]
if (!admin) throw new Error('Seed the isolated workspace account first.')
const req = await createLocalReq({ user: admin, context: { [PLATFORM_MIGRATION]: true } }, payload)
for (const collection of ['posts', 'pages'] as const) {
  const slug = 'fictional-crm-migration-preservation'
  if (
    !(await payload.find({ collection, limit: 1, where: { slug: { equals: slug } }, req })).docs
      .length
  )
    await payload.create({
      collection,
      req,
      data: { title: 'Fictional migration preservation', slug, _status: 'draft' },
    })
}
const tableRows = await payload.db.drizzle.all<{ name: string }>(
  sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
)
const tables = tableRows
  .map((row) => row.name)
  .filter(
    (name) =>
      !name.startsWith('vc_') &&
      !name.startsWith('sqlite_') &&
      !name.startsWith('_cf') &&
      name !== 'payload_migrations' &&
      !name.startsWith('payload_locked_documents'),
  )
const hash = async () => {
  const hashes: Record<string, string> = {}
  for (const table of tables) {
    const rows = await payload.db.drizzle.all(
      sql.raw('SELECT * FROM "' + table.replaceAll('"', '""') + '" ORDER BY rowid'),
    )
    hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  return hashes
}
const before = await hash()
type Statement = {
  toQuery: (config: {
    escapeName: (value: string) => string
    escapeParam: () => string
    escapeString: (value: string) => string
  }) => { sql: string; params: unknown[] }
}
const migrations = [
  { name: '20261020_213000_organization_foundation', ...foundation },
  { name: '20261020_222000_crm_contacts', ...contacts },
  { name: '20261020_233000_authority_restrictions', ...restrictions },
  { name: '20261020_234000_crm_finance', ...finance },
]
const binding = payload.db.drizzle.$client as D1Database
const selected = migrations.map((migration) => ({
  name: migration.name,
  down: async (args: unknown) => migration.down(args as Parameters<typeof migration.down>[0]),
  up: async (rawArgs: unknown) => {
    const args = rawArgs as Parameters<typeof migration.up>[0]
    const statements: Statement[] = []
    await migration.up({
      ...args,
      db: new Proxy(args.db, {
        get(target, property) {
          return property === 'run'
            ? async (statement: unknown): Promise<void> => {
                statements.push(statement as Statement)
              }
            : Reflect.get(target, property)
        },
      }),
    })
    await binding.batch(
      statements.map((statement) => {
        const compiled = statement.toQuery({
          escapeName: (value) => '"' + value.replaceAll('"', '""') + '"',
          escapeParam: () => '?',
          escapeString: (value) => "'" + value.replaceAll("'", "''") + "'",
        })
        return binding.prepare(compiled.sql).bind(...compiled.params)
      }),
    )
  },
}))
await payload.db.migrate({ migrations: selected })
await payload.db.migrate({ migrations: selected })
const after = await hash()
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error('CRM migrations changed historical application records.')
const applied = await payload.find({
  collection: 'payload-migrations',
  limit: 100,
  pagination: false,
})
if (migrations.some((migration) => !applied.docs.some((row) => row.name === migration.name)))
  throw new Error('CRM migrations were not tracked.')
console.log(
  JSON.stringify({
    nativeTrackedMigrationsVerified: migrations.map((row) => row.name),
    historicalTablesPreserved: tables.length,
    repeatSafe: true,
  }),
)
process.exit(0)
