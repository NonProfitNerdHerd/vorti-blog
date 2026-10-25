import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { correspondenceBatchSchemaV1 } from '../crm/correspondence-batch-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of correspondenceBatchSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Correspondence batch history is retained. Use a reviewed recovery point.')
}
