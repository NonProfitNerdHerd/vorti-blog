import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE posts ADD content_layout text;`)
  await db.run(sql`ALTER TABLE pages ADD content_layout text;`)
  await db.run(sql`ALTER TABLE _posts_v ADD version_content_layout text;`)
  await db.run(sql`ALTER TABLE _pages_v ADD version_content_layout text;`)
}
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE posts DROP COLUMN content_layout;`)
  await db.run(sql`ALTER TABLE pages DROP COLUMN content_layout;`)
  await db.run(sql`ALTER TABLE _posts_v DROP COLUMN version_content_layout;`)
  await db.run(sql`ALTER TABLE _pages_v DROP COLUMN version_content_layout;`)
}
