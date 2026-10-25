import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { timelineIndexesV1 } from '../crm/timeline-indexes-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of timelineIndexesV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Timeline lookup indexes are additive. Use a reviewed recovery point.')
}
