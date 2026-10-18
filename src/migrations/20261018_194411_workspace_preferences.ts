import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`ALTER TABLE \`task_board_preferences\` ADD \`favorite_user_id\` integer REFERENCES users(id);`,
  )
  await db.run(
    sql`CREATE INDEX \`task_board_preferences_favorite_user_idx\` ON \`task_board_preferences\` (\`favorite_user_id\`);`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX task_board_preferences_favorite_user_idx;`)
  await db.run(sql`ALTER TABLE task_board_preferences DROP COLUMN favorite_user_id;`)
}
