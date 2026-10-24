import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { householdSchemaV1 } from '../crm/household-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of householdSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Household and relationship history is retained. Use a reviewed recovery point.')
}
