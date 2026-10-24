import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { fundraisingSchemaV1 } from '../crm/fundraising-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql.raw('PRAGMA table_info(vc_crm_funds)'))
  for (const statement of fundraisingSchemaV1) {
    const column = /^ALTER TABLE vc_crm_funds ADD COLUMN (\w+)/.exec(statement)?.[1]
    if (column && columns.some((c) => c.name === column)) continue
    await db.run(sql.raw(statement))
  }
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Fundraising history is retained. Use a reviewed recovery point.')
}
