import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { membershipSchemaV1 } from '../crm/membership-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of membershipSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Membership history is retained. Use a reviewed recovery point.')
}
