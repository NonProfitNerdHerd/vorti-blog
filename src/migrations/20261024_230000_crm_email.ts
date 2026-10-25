import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { emailSchemaV1 } from '../crm/email-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of emailSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Email payloads and delivery history are retained. Use a reviewed recovery point.',
  )
}
