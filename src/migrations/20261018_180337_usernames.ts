import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`attribution_preference\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`attribution_label\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`username\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_username_idx\` ON \`users\` (\`username\`);`)
  await db.run(sql`UPDATE users SET attribution_label = email WHERE attribution_label IS NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`users_username_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`attribution_preference\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`attribution_label\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`username\`;`)
}
