import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`workspace_initialized\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`task_boards\` ADD \`starter_key\` text;`)
  await db.run(
    sql`CREATE UNIQUE INDEX \`task_boards_starter_key_idx\` ON \`task_boards\` (\`starter_key\`);`,
  )
  await db.run(sql`ALTER TABLE \`task_projects\` ADD \`starter_key\` text;`)
  await db.run(
    sql`CREATE UNIQUE INDEX \`task_projects_starter_key_idx\` ON \`task_projects\` (\`starter_key\`);`,
  )
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'This additive migration preserves starter initialization history. Restore the recorded D1 recovery point to roll back.',
  )
}
