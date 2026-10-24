import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { volunteerSchemaV1 } from '../crm/volunteer-schema-v1'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of volunteerSchemaV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Volunteer participation, outreach and time history are retained. Use a reviewed recovery point.',
  )
}
