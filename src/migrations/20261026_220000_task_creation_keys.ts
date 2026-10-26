import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`CREATE TABLE task_board_dependencies (id INTEGER PRIMARY KEY NOT NULL,task_id INTEGER NOT NULL REFERENCES review_tasks(id),predecessor_id INTEGER NOT NULL REFERENCES review_tasks(id),board_id INTEGER NOT NULL REFERENCES task_boards(id),UNIQUE(task_id,predecessor_id))`,
  )
  await db.run(
    sql`CREATE INDEX task_board_dependencies_predecessor_idx ON task_board_dependencies(predecessor_id)`,
  )

  await db.run(sql`ALTER TABLE review_tasks ADD COLUMN creation_key TEXT`)
  await db.run(sql`ALTER TABLE review_tasks ADD COLUMN creation_signature TEXT`)
  await db.run(sql`CREATE UNIQUE INDEX review_tasks_creation_key_idx ON review_tasks(creation_key)`)
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw Error('Creation keys protect task retries. Restore a reviewed recovery point instead.')
}
