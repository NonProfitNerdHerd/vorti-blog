import { sql, type MigrateUpArgs } from '@payloadcms/db-d1-sqlite'
import { migrations } from '../../src/migrations'

type RawSQL = ReturnType<typeof sql>
/** Runs the actual registered migrations, without loading today's Payload
 * collection model while historical schemas are being constructed. */
export async function migrateDatabase(database: D1Database, onApplied?: (name: string) => void) {
  // Registered migrations contain raw SQL, never ORM Column objects requiring
  // a dialect casing cache. Retain parameter binding for interpolated values.
  const compile = (statement: RawSQL) =>
    statement.toQuery({
      escapeName: (value: string) => `"${value.replaceAll('"', '""')}"`,
      escapeParam: () => '?',
      escapeString: (value: string) => `'${value.replaceAll("'", "''")}'`,
    } as unknown as Parameters<RawSQL['toQuery']>[0])
  const db = {
    run: async (statement: RawSQL) => {
      const value = compile(statement)
      return database
        .prepare(value.sql)
        .bind(...value.params)
        .run()
    },
    all: async (statement: RawSQL) => {
      const value = compile(statement)
      return (
        await database
          .prepare(value.sql)
          .bind(...value.params)
          .all()
      ).results
    },
  }
  const installed = await database
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payload_migrations'")
    .first()
  const history = installed
    ? ((await db.all(sql`SELECT name,batch FROM payload_migrations ORDER BY id;`)) as Array<{
        name: string
        batch: number
      }>)
    : []
  if (history.some((row, index) => row.name !== migrations[index]?.name))
    throw Error('Migration ledger must be an exact ordered prefix of the registered chain.')
  const applied: string[] = []
  for (const migration of migrations) {
    if (history.some((row) => row.name === migration.name)) continue
    await migration.up({ db } as unknown as MigrateUpArgs)
    const now = new Date().toISOString(),
      batch = Math.max(0, ...history.map((row) => row.batch)) + 1
    await db.run(
      sql`INSERT INTO payload_migrations(name,batch,updated_at,created_at) VALUES(${migration.name},${batch},${now},${now});`,
    )
    history.push({ name: migration.name, batch })
    applied.push(migration.name)
    onApplied?.(migration.name)
  }
  const violations = await database.prepare('PRAGMA foreign_key_check').all()
  if (violations.results.length) throw Error('Foreign-key validation failed after migrations.')
  return { applied, total: history.length }
}
