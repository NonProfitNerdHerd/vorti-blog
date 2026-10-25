import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { correspondenceSchemaV1 } from '../crm/correspondence-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of correspondenceSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Issued documents, template versions and generation history are retained. Use a reviewed recovery point.',
  )
}
