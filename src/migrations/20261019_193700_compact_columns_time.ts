import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`task_time_audit\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`entry_id\` integer NOT NULL,
    \`actor_id\` integer NOT NULL,
    \`entry_user_id\` integer NOT NULL,
    \`action\` text NOT NULL,
    \`reason\` text,
    \`before_value\` text,
    \`after_value\` text,
    \`operation_key\` text NOT NULL,
    \`fingerprint\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`entry_id\`) REFERENCES \`task_time_entries\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`actor_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`entry_user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_time_audit_task_idx\` ON \`task_time_audit\` (\`task_id\`);`)
  await db.run(
    sql`CREATE INDEX \`task_time_audit_entry_idx\` ON \`task_time_audit\` (\`entry_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`task_time_audit_actor_idx\` ON \`task_time_audit\` (\`actor_id\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`task_time_audit_entry_user_idx\` ON \`task_time_audit\` (\`entry_user_id\`);`,
  )
  await db.run(
    sql`CREATE UNIQUE INDEX \`task_time_audit_operation_key_idx\` ON \`task_time_audit\` (\`operation_key\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`task_time_audit_updated_at_idx\` ON \`task_time_audit\` (\`updated_at\`);`,
  )
  await db.run(
    sql`CREATE INDEX \`task_time_audit_created_at_idx\` ON \`task_time_audit\` (\`created_at\`);`,
  )
  await db.run(
    sql`ALTER TABLE \`review_tasks_rels\` ADD \`users_id\` integer REFERENCES users(id);`,
  )
  await db.run(
    sql`CREATE INDEX \`review_tasks_rels_users_id_idx\` ON \`review_tasks_rels\` (\`users_id\`);`,
  )
  await db.run(
    sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_time_audit_id\` integer REFERENCES task_time_audit(id);`,
  )
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_task_time_audit_id_idx\` ON \`payload_locked_documents_rels\` (\`task_time_audit_id\`);`,
  )
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Restore the recorded D1 recovery point to preserve time audit and collaborator relationships.',
  )
}
