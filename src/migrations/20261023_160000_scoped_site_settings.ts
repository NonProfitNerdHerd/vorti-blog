import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { siteSettingsSchema } from '../organizations/site-settings'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of siteSettingsSchema) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Site settings are retained. Use a reviewed recovery point to revert.')
}
