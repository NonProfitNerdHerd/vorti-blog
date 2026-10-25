import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { importExportSchemaV1 } from '../crm/import-export-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of importExportSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw Error('Private import result history is retained. Use a reviewed recovery point.')
}
