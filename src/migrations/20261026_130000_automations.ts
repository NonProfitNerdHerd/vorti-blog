import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import {
  automationSchema,
  nativeAutomationSources,
  sourceTriggers,
  contactAutomationTrigger,
} from '../automations/schema'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of automationSchema) await db.run(sql.raw(statement))
  for (const source of nativeAutomationSources) {
    if (source.origin)
      await db.run(sql.raw(`ALTER TABLE ${source.table} ADD COLUMN automation_origin TEXT`))
    if (source.table === 'review_tasks')
      await db.run(sql.raw('ALTER TABLE review_tasks ADD COLUMN automation_site TEXT'))
    if (source.table === 'pages' || source.table === 'posts')
      await db.run(
        sql.raw(`ALTER TABLE _${source.table}_v ADD COLUMN version_automation_origin TEXT`),
      )
    for (const statement of sourceTriggers(source)) await db.run(sql.raw(statement))
  }
  await db.run(sql.raw(contactAutomationTrigger))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw Error('Automation definitions and run history are retained. Use a reviewed recovery point.')
}
