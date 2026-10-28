import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { commentSchemaV1 } from '../crm/comment-schema-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of commentSchemaV1) await db.run(sql.raw(statement))
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Constituent comments and their audit history are retained.')
}
