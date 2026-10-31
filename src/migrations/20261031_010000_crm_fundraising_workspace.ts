import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { fundraisingSchemaV2 } from '../crm/fundraising-schema-v2'
import { crmTaskSchemaV2 } from '../crm/task-context-v2'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of fundraisingSchemaV2) await db.run(sql.raw(statement))
  for (const statement of crmTaskSchemaV2) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Fundraising relationships and appeal audience history are retained.')
}
