import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { attachmentSchemaV1 } from '../crm/attachment-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of attachmentSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Private attachment history is retained. Use a reviewed recovery point.')
}
