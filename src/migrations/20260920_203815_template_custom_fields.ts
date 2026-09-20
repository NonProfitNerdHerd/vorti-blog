import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`design_templates\` ADD \`custom_fields\` text DEFAULT '[]';`)
  await db.run(sql`ALTER TABLE \`_design_templates_v\` ADD \`version_custom_fields\` text DEFAULT '[]';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`design_templates\` DROP COLUMN \`custom_fields\`;`)
  await db.run(sql`ALTER TABLE \`_design_templates_v\` DROP COLUMN \`version_custom_fields\`;`)
}
