import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { organizationSchemaV2 } from '../organizations/schema-v2'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of organizationSchemaV2) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Authority restrictions and retained account history require a reviewed recovery point.',
  )
}
