/** Upgrade a representative native fixture, twice, without changing any earlier domain rows. */
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getPayload } from 'payload'
import { migrations } from '../../src/migrations'
const state = process.env.DESIGN_CORE_TEST_PERSIST_PATH
if (
  !state ||
  path.resolve(state) !== path.resolve('.wrangler/crm-expansion-release') ||
  process.env.DESIGN_PRODUCTION_MIGRATE ||
  process.env.DESIGN_PRODUCTION_DEPLOY
)
  throw new Error('An isolated CRM expansion release database is required.')
process.env.PAYLOAD_MIGRATING = 'true'
const { default: config } = await import('../../src/payload.config')
const payload = await getPayload({ config })
const adapter = payload.db as unknown as {
  client: D1Database
  drizzle: Parameters<(typeof migrations)[0]['up']>[0]['db']
}
const db = adapter.client
const tables = (
  await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN('_cf_KV','_cf_METADATA','payload_migrations','vc_write_guards') ORDER BY name",
    )
    .all<{ name: string }>()
).results
const originalColumns = new Map<string, string[]>()
for (const { name } of tables) {
  if (!/^\w+$/.test(name)) throw new Error('Unexpected historical table.')
  originalColumns.set(
    name,
    (await db.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>()).results.map(
      (c) => c.name,
    ),
  )
}
async function snapshot() {
  const hashes = new Map<string, string>()
  for (const { name } of tables) {
    if (!/^\w+$/.test(name)) throw new Error('Unexpected historical table.')
    const fields = originalColumns
      .get(name)!
      .map((column) => `"${column.replaceAll('"', '""')}"`)
      .join(',')
    const rows = (await db.prepare(`SELECT ${fields} FROM "${name}"`).all()).results
    hashes.set(
      name,
      createHash('sha256')
        .update(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort()))
        .digest('hex'),
    )
  }
  return hashes
}
const before = await snapshot(),
  pending = migrations.filter((m) => m.name.startsWith('20261024_'))
if (pending.length !== 6) throw new Error('Review the exact migration set before upgrading.')
const batch = Number(
  (await db
    .prepare('SELECT COALESCE(MAX(batch),0)+1 AS n FROM payload_migrations')
    .first<{ n: number }>())!.n,
)
for (let repeat = 0; repeat < 2; repeat++)
  for (const migration of pending) {
    await migration.up({ db: adapter.drizzle, payload } as Parameters<typeof migration.up>[0])
    if (
      !(await db
        .prepare('SELECT id FROM payload_migrations WHERE name=?')
        .bind(migration.name)
        .first())
    ) {
      const now = new Date().toISOString()
      await db
        .prepare('INSERT INTO payload_migrations(name,batch,created_at,updated_at) VALUES(?,?,?,?)')
        .bind(migration.name, batch, now, now)
        .run()
    }
  }
// Compare every pre-existing field, including the fund columns, across additive upgrades.
const after = await snapshot()
for (const [name, hash] of before)
  if (after.get(name) !== hash) throw new Error(`Historical rows changed: ${name}`)
if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length)
  throw new Error('Foreign key verification failed.')
console.log(
  JSON.stringify({
    localOnly: true,
    migrations: pending.map((m) => m.name),
    repeatPassed: true,
    historicalTables: tables.length,
  }),
)
process.exit(0)
