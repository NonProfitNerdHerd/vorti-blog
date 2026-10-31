import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { campaignBoardSchemaV1 } from '../crm/campaign-board-schema-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of campaignBoardSchemaV1) await db.run(sql.raw(statement))
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Campaign board links are retained.')
}
