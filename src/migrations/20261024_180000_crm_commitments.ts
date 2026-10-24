import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { commitmentSchemaV1 } from '../crm/commitment-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of commitmentSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Giving and payment history is retained. Use a reviewed recovery point.')
}
