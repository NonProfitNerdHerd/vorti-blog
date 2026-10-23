import path from 'node:path'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-d1-sqlite'
import * as foundation from '../../src/migrations/20261020_213000_organization_foundation'
import * as contacts from '../../src/migrations/20261020_222000_crm_contacts'
import * as restrictions from '../../src/migrations/20261020_233000_authority_restrictions'
import * as finance from '../../src/migrations/20261020_234000_crm_finance'
import * as cms from '../../src/migrations/20261021_080000_cms_site_ownership'
import * as workspace from '../../src/migrations/20261021_090000_workspace_site_ownership'
import * as mutationGuards from '../../src/migrations/20261022_010000_native_mutation_guards'
import * as scopedSettings from '../../src/migrations/20261023_160000_scoped_site_settings'
import * as globalGuards from '../../src/migrations/20261023_163000_global_commit_guards'
import * as authenticationGuards from '../../src/migrations/20261023_170000_native_authentication_guards'
import { guardedMutations } from '../../src/organizations/mutation-guards'
import { cmsCollections } from '../../src/organizations/cms-collections'

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
const binding = payload.db.drizzle.$client as D1Database
const admin = await binding
  .prepare('SELECT id FROM users WHERE email=? LIMIT 1')
  .bind('dev@payloadcms.com')
  .first<{ id: number }>()
if (!admin) throw new Error('Seed the isolated workspace account first.')
// Seed legacy-shaped fixtures through bounded SQL, so the new application need not read columns
// that do not exist until its migration runs. This helper only accepts an isolated local database.
for (const collection of ['posts', 'pages'] as const) {
  const slug = 'fictional-crm-migration-preservation'
  if (
    await binding.prepare(`SELECT id FROM "${collection}" WHERE slug=? LIMIT 1`).bind(slug).first()
  )
    continue
  const columns = (
    await binding.prepare(`PRAGMA table_info("${collection}")`).all<{ name: string }>()
  ).results
  const now = new Date().toISOString(),
    content = JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', text: 'Fictional historical content', version: 1 }],
          },
        ],
      },
    })
  const row: Record<string, string | number> = {
    title: 'Fictional migration preservation',
    slug,
    _status: 'draft',
    content,
    updated_at: now,
    created_at: now,
  }
  if (columns.some((column) => column.name === 'platform_site')) {
    const root = await binding
      .prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'")
      .first<{ authority_revision: number }>()
      .catch((): null => null)
    Object.assign(row, {
      platform_site: 'default',
      platform_write_actor: Number(admin.id),
      platform_write_epoch: root?.authority_revision || 0,
    })
  }
  const keys = Object.keys(row)
  await binding
    .prepare(
      `INSERT INTO "${collection}" (${keys.map((key) => `"${key}"`).join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
    )
    .bind(...Object.values(row))
    .run()
  const parent = await binding
    .prepare(`SELECT id FROM "${collection}" WHERE slug=?`)
    .bind(slug)
    .first<{ id: number }>()
  const version = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [`version_${key}`, value]),
  )
  Object.assign(version, { parent_id: parent!.id, updated_at: now, created_at: now })
  const versionColumns = (
    await binding.prepare(`PRAGMA table_info("_${collection}_v")`).all<{ name: string }>()
  ).results
  const entries = Object.entries(version).filter(([key]) =>
    versionColumns.some((column) => column.name === key),
  )
  await binding
    .prepare(
      `INSERT INTO "_${collection}_v" (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES(${entries.map(() => '?').join(',')})`,
    )
    .bind(...entries.map(([, value]) => value))
    .run()
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
const historicalColumns: Record<string, string[]> = {}
for (const table of tables)
  historicalColumns[table] = (
    await binding.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>()
  ).results
    .map((column) => column.name)
    .filter((name) => !/^(version_)?platform_(site|write_actor|write_epoch)$/.test(name))
const hash = async () => {
  const hashes: Record<string, string> = {}
  for (const table of tables) {
    const rows = await payload.db.drizzle.all(
      sql.raw(
        'SELECT ' +
          historicalColumns[table].map((name) => '"' + name.replaceAll('"', '""') + '"').join(',') +
          ' FROM "' +
          table.replaceAll('"', '""') +
          '" ORDER BY rowid',
      ),
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
  { name: '20261021_080000_cms_site_ownership', ...cms },
  { name: '20261021_090000_workspace_site_ownership', ...workspace },
  { name: '20261022_010000_native_mutation_guards', ...mutationGuards },
  { name: '20261023_160000_scoped_site_settings', ...scopedSettings },
  { name: '20261023_163000_global_commit_guards', ...globalGuards },
  { name: '20261023_170000_native_authentication_guards', ...authenticationGuards },
]
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
for (const [, table, versions] of cmsCollections)
  for (const [name, column] of [
    [table, 'platform_site'],
    ...(versions ? [[versions, 'version_platform_site']] : []),
  ]) {
    const row = await binding
      .prepare(`SELECT count(*) AS missing FROM "${name}" WHERE "${column}" IS NULL`)
      .first<{ missing: number }>()
    if (row?.missing) throw new Error('CMS ownership backfill left unscoped records.')
  }
const snapshot = JSON.parse(
  readFileSync('src/migrations/20261021_090000_workspace_site_ownership.json', 'utf8'),
) as {
  tables: Record<string, { indexes: Record<string, { columns: string[]; isUnique: boolean }> }>
}
let indexesVerified = 0
for (const [table, expected] of Object.entries(snapshot.tables)) {
  const desired = Object.entries(expected.indexes).filter(
    ([name, index]) =>
      table === 'vc_workspace_access' ||
      table === 'vc_user_sites' ||
      /platform.?site|vc_user_sites|vc_workspace_access/i.test(name) ||
      (table === 'forms' && index.columns.join(',') === 'site,slug'),
  )
  if (!desired.length) continue
  const actual = (
    await binding.prepare(`PRAGMA index_list("${table}")`).all<{ name: string; unique: number }>()
  ).results
  for (const [name, definition] of desired) {
    const existing = actual.find((index) => index.name === name)
    if (!existing || Boolean(existing.unique) !== definition.isUnique)
      throw new Error(`Missing native ownership index ${name}.`)
    const fields = (
      await binding.prepare(`PRAGMA index_info("${name}")`).all<{ name: string }>()
    ).results.map((field) => field.name)
    if (fields.join(',') !== definition.columns.join(','))
      throw new Error(`Native ownership index ${name} differs from its snapshot.`)
    indexesVerified++
  }
}
const applied = await payload.find({
  collection: 'payload-migrations',
  limit: 100,
  pagination: false,
})
let mutationProofColumnsVerified = 0
for (const [, table, versions] of guardedMutations) {
  for (const [target, column] of [[table, 'platform_mutation_proof'], ...(versions ? [[versions, 'version_platform_mutation_proof']] : [])]) {
    const columns = (await binding.prepare(`PRAGMA table_info("${target}")`).all<{ name: string }>()).results
    if (!columns.some(field => field.name === column)) throw new Error(`Missing native mutation proof column on ${target}.`)
    mutationProofColumnsVerified++
  }
  for (const suffix of ['insert', 'update', 'delete', 'deleted'])
    if (!await binding.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").bind(`${table}_vc_mutation_${suffix}`).first())
      throw new Error(`Missing native mutation guard on ${table}.`)
}
if (migrations.some((migration) => !applied.docs.some((row) => row.name === migration.name)))
  throw new Error('CRM migrations were not tracked.')
console.log(
  JSON.stringify({
    nativeTrackedMigrationsVerified: migrations.map((row) => row.name),
    historicalTablesPreserved: tables.length,
    repeatSafe: true,
    nativeOwnershipIndexesVerified: indexesVerified,
    nativeMutationProofColumnsVerified: mutationProofColumnsVerified,
  }),
)
process.exit(0)
