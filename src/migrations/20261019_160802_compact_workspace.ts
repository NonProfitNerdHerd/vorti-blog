import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`task_board_preferences\` ADD \`icon_color\` text;`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Restore the recorded D1 recovery point to roll back without deleting personal preferences.',
  )
}
