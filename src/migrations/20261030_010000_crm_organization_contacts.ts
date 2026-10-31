import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { organizationContactsSchemaV1 } from '../crm/organization-contacts-schema-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of organizationContactsSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Organization contact relationships and audit history are retained.')
}
