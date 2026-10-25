import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { applyCRMTaskSchemaV1 } from '../crm/task-schema-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await applyCRMTaskSchemaV1(
    async (statement) => db.run(sql.raw(statement)),
    async (table = 'review_tasks') =>
      db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`)),
    async () =>
      db.all<{ name: string }>(sql.raw("SELECT name FROM sqlite_master WHERE type='table'")),
  )
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('CRM-linked Tasks and their history are retained. Use a reviewed recovery point.')
}
