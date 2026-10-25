import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { applyImportSchemaV1 } from '../crm/import-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await applyImportSchemaV1(
    async (statement) => db.run(sql.raw(statement)),
    async () => db.all<{ name: string }>(sql.raw('PRAGMA table_info(vc_crm_source_identifiers)')),
  )
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Import source rows, approvals and identifier lineage are retained. Use a reviewed recovery point.',
  )
}
