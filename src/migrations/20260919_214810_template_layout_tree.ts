import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`design_templates\` ADD \`layout\` text DEFAULT '[]';`)
  await db.run(sql`ALTER TABLE \`_design_templates_v\` ADD \`version_layout\` text DEFAULT '[]';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`design_templates\` DROP COLUMN \`layout\`;`)
  await db.run(sql`ALTER TABLE \`_design_templates_v\` DROP COLUMN \`version_layout\`;`)
}
