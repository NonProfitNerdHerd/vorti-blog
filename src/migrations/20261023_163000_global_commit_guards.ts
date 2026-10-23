import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { guardedGlobals, globalSettingsGuards } from '../organizations/site-settings'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const table of guardedGlobals) {
    const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`))
    if (!columns.some((column) => column.name === 'platform_global_proof'))
      await db.run(sql.raw(`ALTER TABLE "${table}" ADD COLUMN platform_global_proof text`))
  }
  for (const statement of globalSettingsGuards) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Global authorization guards are retained. Use a reviewed recovery point to revert.',
  )
}
