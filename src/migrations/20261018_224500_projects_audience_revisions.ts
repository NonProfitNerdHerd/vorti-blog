import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { workspaceRevisionTriggers } from '../review/workspace-revisions'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`task_boards\` ADD \`membership_revision\` numeric DEFAULT 0;`)
  await db.run(sql`ALTER TABLE \`task_projects\` ADD \`membership_revision\` numeric DEFAULT 0;`)
  for (const statement of workspaceRevisionTriggers) await db.run(sql.raw(statement))
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  throw new Error(
    'This additive migration preserves collaboration history; restore using the recorded recovery point.',
  )
}
