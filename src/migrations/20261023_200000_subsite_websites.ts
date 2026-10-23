import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { websiteSchemaV1 } from '../organizations/website-schema-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const tables = [
    'site_tpl',
    'design_templates',
    'design_block_types',
    'design_block_designs',
    'menus',
    'media',
  ]
  const versions = [
    '_site_tpl_v',
    '_design_templates_v',
    '_design_block_types_v',
    '_design_block_designs_v',
  ]
  for (const table of [...tables, ...versions]) {
    const columns = await db.all<{ name: string }>(sql.raw('PRAGMA table_info("' + table + '")'))
    if (!columns.length) continue
    const column = versions.includes(table) ? 'version_website_copy_key' : 'website_copy_key'
    if (!columns.some((item) => item.name === column))
      await db.run(sql.raw('ALTER TABLE "' + table + '" ADD COLUMN "' + column + '" TEXT'))
    if (!versions.includes(table))
      await db.run(
        sql.raw(
          'CREATE UNIQUE INDEX IF NOT EXISTS "' +
            table +
            '_website_copy_key_idx" ON "' +
            table +
            '"(website_copy_key)',
        ),
      )
  }
  for (const statement of websiteSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Website data is retained. Use the reviewed recovery procedure.')
}
