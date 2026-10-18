import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`review_tasks_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`task_boards_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_boards_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`review_tasks_rels_order_idx\` ON \`review_tasks_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`review_tasks_rels_parent_idx\` ON \`review_tasks_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`review_tasks_rels_path_idx\` ON \`review_tasks_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`review_tasks_rels_task_boards_id_idx\` ON \`review_tasks_rels\` (\`task_boards_id\`);`)
  await db.run(sql`CREATE TABLE \`task_boards\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`name\` text NOT NULL,
    \`description\` text,
    \`owner_id\` integer NOT NULL,
    \`visibility\` text DEFAULT 'private' NOT NULL,
    \`archived\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_boards_owner_idx\` ON \`task_boards\` (\`owner_id\`);`)
  await db.run(sql`CREATE INDEX \`task_boards_visibility_idx\` ON \`task_boards\` (\`visibility\`);`)
  await db.run(sql`CREATE INDEX \`task_boards_archived_idx\` ON \`task_boards\` (\`archived\`);`)
  await db.run(sql`CREATE INDEX \`task_boards_updated_at_idx\` ON \`task_boards\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_boards_created_at_idx\` ON \`task_boards\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_board_memberships\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`user_id\` integer NOT NULL,
    \`role\` text DEFAULT 'viewer' NOT NULL,
    \`key\` text NOT NULL,
    \`edit_user_id\` integer,
    \`comment_user_id\` integer,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`edit_user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`comment_user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_board_memberships_board_idx\` ON \`task_board_memberships\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_memberships_user_idx\` ON \`task_board_memberships\` (\`user_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_board_memberships_key_idx\` ON \`task_board_memberships\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_board_memberships_edit_user_idx\` ON \`task_board_memberships\` (\`edit_user_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_memberships_comment_user_idx\` ON \`task_board_memberships\` (\`comment_user_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_memberships_updated_at_idx\` ON \`task_board_memberships\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_board_memberships_created_at_idx\` ON \`task_board_memberships\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_sections\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`name\` text NOT NULL,
    \`position\` numeric DEFAULT 0,
    \`archived\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_sections_board_idx\` ON \`task_sections\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_sections_updated_at_idx\` ON \`task_sections\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_sections_created_at_idx\` ON \`task_sections\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_placements\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`board_id\` integer NOT NULL,
    \`section_id\` integer,
    \`position\` numeric DEFAULT 0,
    \`key\` text NOT NULL,
    \`active\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`section_id\`) REFERENCES \`task_sections\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_placements_task_idx\` ON \`task_placements\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_placements_board_idx\` ON \`task_placements\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_placements_section_idx\` ON \`task_placements\` (\`section_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_placements_key_idx\` ON \`task_placements\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_placements_active_idx\` ON \`task_placements\` (\`active\`);`)
  await db.run(sql`CREATE INDEX \`task_placements_updated_at_idx\` ON \`task_placements\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_placements_created_at_idx\` ON \`task_placements\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_followers\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`user_id\` integer NOT NULL,
    \`key\` text NOT NULL,
    \`following\` integer DEFAULT true,
    \`muted\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_followers_task_idx\` ON \`task_followers\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_followers_user_idx\` ON \`task_followers\` (\`user_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_followers_key_idx\` ON \`task_followers\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_followers_updated_at_idx\` ON \`task_followers\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_followers_created_at_idx\` ON \`task_followers\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_board_preferences\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`user_id\` integer NOT NULL,
    \`key\` text NOT NULL,
    \`favorite\` integer DEFAULT false,
    \`view\` text DEFAULT 'list',
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_board_preferences_board_idx\` ON \`task_board_preferences\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_preferences_user_idx\` ON \`task_board_preferences\` (\`user_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_board_preferences_key_idx\` ON \`task_board_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_board_preferences_updated_at_idx\` ON \`task_board_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_board_preferences_created_at_idx\` ON \`task_board_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_sharing_requests\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`destination_id\` integer NOT NULL,
    \`requester_id\` integer NOT NULL,
    \`fingerprint\` text NOT NULL,
    \`state\` text DEFAULT 'pending' NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`destination_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`requester_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_task_idx\` ON \`task_sharing_requests\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_destination_idx\` ON \`task_sharing_requests\` (\`destination_id\`);`)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_requester_idx\` ON \`task_sharing_requests\` (\`requester_id\`);`)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_updated_at_idx\` ON \`task_sharing_requests\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_created_at_idx\` ON \`task_sharing_requests\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_sharing_requests_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`users_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`task_sharing_requests\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_rels_order_idx\` ON \`task_sharing_requests_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_rels_parent_idx\` ON \`task_sharing_requests_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_rels_path_idx\` ON \`task_sharing_requests_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`task_sharing_requests_rels_users_id_idx\` ON \`task_sharing_requests_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`task_notifications\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`recipient_id\` integer NOT NULL,
    \`task_id\` integer,
    \`board_id\` integer,
    \`comment_id\` integer,
    \`request_id\` integer,
    \`kind\` text NOT NULL,
    \`message\` text NOT NULL,
    \`key\` text NOT NULL,
    \`read\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`recipient_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`comment_id\`) REFERENCES \`review_comments\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`request_id\`) REFERENCES \`task_sharing_requests\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_notifications_recipient_idx\` ON \`task_notifications\` (\`recipient_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_task_idx\` ON \`task_notifications\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_board_idx\` ON \`task_notifications\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_comment_idx\` ON \`task_notifications\` (\`comment_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_request_idx\` ON \`task_notifications\` (\`request_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_notifications_key_idx\` ON \`task_notifications\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_read_idx\` ON \`task_notifications\` (\`read\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_updated_at_idx\` ON \`task_notifications\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_created_at_idx\` ON \`task_notifications\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_board_activity\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`actor_id\` integer,
    \`message\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`actor_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_board_activity_board_idx\` ON \`task_board_activity\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_activity_actor_idx\` ON \`task_board_activity\` (\`actor_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_activity_updated_at_idx\` ON \`task_board_activity\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_board_activity_created_at_idx\` ON \`task_board_activity\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_notification_events\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`task_id\` integer,
    \`actor_id\` integer,
    \`comment_id\` integer,
    \`deliveries\` text NOT NULL,
    \`delivered\` integer DEFAULT false,
    \`attempts\` numeric DEFAULT 0,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`actor_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`comment_id\`) REFERENCES \`review_comments\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`task_notification_events_key_idx\` ON \`task_notification_events\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_notification_events_task_idx\` ON \`task_notification_events\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notification_events_actor_idx\` ON \`task_notification_events\` (\`actor_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notification_events_comment_idx\` ON \`task_notification_events\` (\`comment_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notification_events_delivered_idx\` ON \`task_notification_events\` (\`delivered\`);`)
  await db.run(sql`CREATE INDEX \`task_notification_events_updated_at_idx\` ON \`task_notification_events\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_notification_events_created_at_idx\` ON \`task_notification_events\` (\`created_at\`);`)
  // Preserve existing tables, IDs, foreign keys, and NOT NULL document storage.
  // Standalone tasks use an empty document-reference pair.
  await db.run(sql`ALTER TABLE review_tasks ADD COLUMN mentions text;`)
  await db.run(sql`ALTER TABLE review_tasks ADD COLUMN personal integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE review_comments ADD COLUMN mentions text;`)
  await db.run(sql`CREATE TABLE task_workspace_guards (id text PRIMARY KEY NOT NULL, valid integer NOT NULL CHECK (valid = 1));`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_boards_id\` integer REFERENCES task_boards(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_board_memberships_id\` integer REFERENCES task_board_memberships(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_sections_id\` integer REFERENCES task_sections(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_placements_id\` integer REFERENCES task_placements(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_followers_id\` integer REFERENCES task_followers(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_board_preferences_id\` integer REFERENCES task_board_preferences(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_sharing_requests_id\` integer REFERENCES task_sharing_requests(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_notifications_id\` integer REFERENCES task_notifications(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_board_activity_id\` integer REFERENCES task_board_activity(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_notification_events_id\` integer REFERENCES task_notification_events(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_boards_id_idx\` ON \`payload_locked_documents_rels\` (\`task_boards_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_memberships_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_memberships_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_sections_id_idx\` ON \`payload_locked_documents_rels\` (\`task_sections_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_placements_id_idx\` ON \`payload_locked_documents_rels\` (\`task_placements_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_followers_id_idx\` ON \`payload_locked_documents_rels\` (\`task_followers_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_preferences_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_preferences_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_sharing_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`task_sharing_requests_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_notifications_id_idx\` ON \`payload_locked_documents_rels\` (\`task_notifications_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_activity_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_activity_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_notification_events_i_idx\` ON \`payload_locked_documents_rels\` (\`task_notification_events_id\`);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("Task workspace rollback is non-destructive. Roll back the application and retain the additive tables.");
}
