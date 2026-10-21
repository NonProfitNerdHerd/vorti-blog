import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { financeSchemaV1 } from '../crm/finance-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of financeSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Financial history is retained. Use a reviewed recovery point to revert.')
}
