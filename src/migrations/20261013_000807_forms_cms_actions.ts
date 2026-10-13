import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`form_contacts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`site\` text NOT NULL,
    \`action_key\` text NOT NULL,
    \`source_entry_id\` integer,
    \`name\` text,
    \`email\` text NOT NULL,
    \`notes\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`source_entry_id\`) REFERENCES \`form_submissions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`form_contacts_site_idx\` ON \`form_contacts\` (\`site\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`form_contacts_action_key_idx\` ON \`form_contacts\` (\`action_key\`);`)
  await db.run(sql`CREATE INDEX \`form_contacts_source_entry_idx\` ON \`form_contacts\` (\`source_entry_id\`);`)
  await db.run(sql`CREATE INDEX \`form_contacts_updated_at_idx\` ON \`form_contacts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`form_contacts_created_at_idx\` ON \`form_contacts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`form_support_requests\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`site\` text NOT NULL,
    \`action_key\` text NOT NULL,
    \`source_entry_id\` integer,
    \`title\` text NOT NULL,
    \`details\` text NOT NULL,
    \`email\` text,
    \`status\` text DEFAULT 'received',
    \`reviewer_id\` integer,
    \`notes\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`source_entry_id\`) REFERENCES \`form_submissions\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`reviewer_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`form_support_requests_site_idx\` ON \`form_support_requests\` (\`site\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`form_support_requests_action_key_idx\` ON \`form_support_requests\` (\`action_key\`);`)
  await db.run(sql`CREATE INDEX \`form_support_requests_source_entry_idx\` ON \`form_support_requests\` (\`source_entry_id\`);`)
  await db.run(sql`CREATE INDEX \`form_support_requests_reviewer_idx\` ON \`form_support_requests\` (\`reviewer_id\`);`)
  await db.run(sql`CREATE INDEX \`form_support_requests_updated_at_idx\` ON \`form_support_requests\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`form_support_requests_created_at_idx\` ON \`form_support_requests\` (\`created_at\`);`)
  // Resource default changes are applied by Payload; do not rebuild the existing booking table.
  await db.run(sql`ALTER TABLE \`posts\` ADD \`form_action_key\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`posts_form_action_key_idx\` ON \`posts\` (\`form_action_key\`);`)
  await db.run(sql`ALTER TABLE \`_posts_v\` ADD \`version_form_action_key\` text;`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_form_action_key_idx\` ON \`_posts_v\` (\`version_form_action_key\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`form_contacts_id\` integer REFERENCES form_contacts(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`form_support_requests_id\` integer REFERENCES form_support_requests(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_contacts_id_idx\` ON \`payload_locked_documents_rels\` (\`form_contacts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_support_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`form_support_requests_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('CMS action records must be preserved. Restore a reviewed backup instead of dropping data.')
}
