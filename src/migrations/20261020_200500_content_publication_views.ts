import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
/** Add publication dates without guessing dates for historical pages or versions. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE pages ADD COLUMN published_at text;`)
  await db.run(sql`ALTER TABLE _pages_v ADD COLUMN version_published_at text;`)
  await db.run(sql`CREATE INDEX pages_published_at_idx ON pages (published_at);`)
  await db.run(sql`CREATE INDEX _pages_v_version_published_at_idx ON _pages_v (version_published_at);`)
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Restore the recorded D1 recovery point to revert publication-date storage.')
}
