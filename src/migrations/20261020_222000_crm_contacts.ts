import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { contactSchemaV1 } from '../crm/contact-schema-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of contactSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Constituent identity and chapter history are retained. Restore a reviewed D1 recovery point to revert this migration.',
  )
}
