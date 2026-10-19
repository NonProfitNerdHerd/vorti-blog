import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`review_tasks\` ADD \`completed_at\` text;`)
  await db.run(
    sql`CREATE INDEX \`review_tasks_completed_at_idx\` ON \`review_tasks\` (\`completed_at\`);`,
  )
  await db.run(sql`ALTER TABLE \`task_boards\` ADD \`presentation\` text;`)
  await db.run(sql`UPDATE task_board_preferences SET view_settings=(
    SELECT json_group_object(entry.key, CASE
      WHEN entry.type='object' AND EXISTS(
        SELECT 1 FROM task_views view WHERE view.board_id=task_board_preferences.board_id AND CAST(view.id AS text)=entry.key AND view.kind IN ('list','board')
      ) THEN json_set(entry.value,'$.group','status')
      WHEN entry.type IN ('object','array') THEN json(entry.value)
      WHEN entry.type='true' THEN json('true') WHEN entry.type='false' THEN json('false')
      ELSE entry.value END)
    FROM json_each(task_board_preferences.view_settings) entry
  ) WHERE json_valid(view_settings) AND json_type(view_settings)='object';`)
  await db.run(sql`INSERT INTO task_views(board_id,name,kind,position,default_view)
    SELECT board.id,'Timeline','gantt',COALESCE((SELECT max(position)+1 FROM task_views WHERE board_id=board.id),0),0
    FROM task_boards board WHERE NOT EXISTS(SELECT 1 FROM task_views WHERE board_id=board.id AND kind IN ('timeline','gantt'));`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Restore the recorded D1 recovery point to preserve completion history and view preferences.',
  )
}
