import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { crmJobSchemaV1 } from '../crm/job-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of crmJobSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('CRM job history is retained. Use a reviewed recovery point.')
}
