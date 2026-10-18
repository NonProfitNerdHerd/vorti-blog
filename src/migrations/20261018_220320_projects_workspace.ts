import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`task_projects\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`name\` text NOT NULL,
    \`description\` text,
    \`owner_id\` integer,
    \`visibility\` text DEFAULT 'private' NOT NULL,
    \`archived\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_projects_owner_idx\` ON \`task_projects\` (\`owner_id\`);`)
  await db.run(sql`CREATE INDEX \`task_projects_archived_idx\` ON \`task_projects\` (\`archived\`);`)
  await db.run(sql`CREATE INDEX \`task_projects_updated_at_idx\` ON \`task_projects\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_projects_created_at_idx\` ON \`task_projects\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_project_memberships\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`project_id\` integer NOT NULL,
    \`user_id\` integer,
    \`role\` text DEFAULT 'viewer' NOT NULL,
    \`key\` text,
    \`edit_user_id\` integer,
    \`comment_user_id\` integer,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`project_id\`) REFERENCES \`task_projects\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`edit_user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`comment_user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_project_memberships_project_idx\` ON \`task_project_memberships\` (\`project_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_memberships_user_idx\` ON \`task_project_memberships\` (\`user_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_project_memberships_key_idx\` ON \`task_project_memberships\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_project_memberships_edit_user_idx\` ON \`task_project_memberships\` (\`edit_user_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_memberships_comment_user_idx\` ON \`task_project_memberships\` (\`comment_user_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_memberships_updated_at_idx\` ON \`task_project_memberships\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_project_memberships_created_at_idx\` ON \`task_project_memberships\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_project_preferences\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`project_id\` integer NOT NULL,
    \`user_id\` integer,
    \`key\` text,
    \`favorite\` integer,
    \`expanded\` integer DEFAULT true,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`project_id\`) REFERENCES \`task_projects\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_project_preferences_project_idx\` ON \`task_project_preferences\` (\`project_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_preferences_user_idx\` ON \`task_project_preferences\` (\`user_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_project_preferences_key_idx\` ON \`task_project_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_project_preferences_updated_at_idx\` ON \`task_project_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_project_preferences_created_at_idx\` ON \`task_project_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_views\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`name\` text NOT NULL,
    \`kind\` text NOT NULL,
    \`position\` numeric DEFAULT 0,
    \`default_view\` integer,
    \`configuration\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_views_board_idx\` ON \`task_views\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_views_updated_at_idx\` ON \`task_views\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_views_created_at_idx\` ON \`task_views\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_board_fields\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`field_id\` integer NOT NULL,
    \`position\` numeric DEFAULT 0,
    \`key\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`field_id\`) REFERENCES \`task_field_definitions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_board_fields_board_idx\` ON \`task_board_fields\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_fields_field_idx\` ON \`task_board_fields\` (\`field_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_board_fields_key_idx\` ON \`task_board_fields\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_board_fields_updated_at_idx\` ON \`task_board_fields\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_board_fields_created_at_idx\` ON \`task_board_fields\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_board_pages\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`view_id\` integer NOT NULL,
    \`body\` text NOT NULL,
    \`key\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`view_id\`) REFERENCES \`task_views\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_board_pages_board_idx\` ON \`task_board_pages\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_pages_view_idx\` ON \`task_board_pages\` (\`view_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_board_pages_key_idx\` ON \`task_board_pages\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_board_pages_updated_at_idx\` ON \`task_board_pages\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_board_pages_created_at_idx\` ON \`task_board_pages\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_baselines\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`name\` text NOT NULL,
    \`snapshot\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_baselines_board_idx\` ON \`task_baselines\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_baselines_updated_at_idx\` ON \`task_baselines\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_baselines_created_at_idx\` ON \`task_baselines\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_field_definitions\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`name\` text NOT NULL,
    \`kind\` text NOT NULL,
    \`creator_id\` integer,
    \`configuration\` text,
    \`system_key\` text,
    \`archived\` integer DEFAULT false,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`creator_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_field_definitions_creator_idx\` ON \`task_field_definitions\` (\`creator_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_field_definitions_system_key_idx\` ON \`task_field_definitions\` (\`system_key\`);`)
  await db.run(sql`CREATE INDEX \`task_field_definitions_updated_at_idx\` ON \`task_field_definitions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_field_definitions_created_at_idx\` ON \`task_field_definitions\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_field_values\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`field_id\` integer NOT NULL,
    \`key\` text,
    \`value\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`field_id\`) REFERENCES \`task_field_definitions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_field_values_task_idx\` ON \`task_field_values\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_field_values_field_idx\` ON \`task_field_values\` (\`field_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_field_values_key_idx\` ON \`task_field_values\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_field_values_updated_at_idx\` ON \`task_field_values\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_field_values_created_at_idx\` ON \`task_field_values\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_dependencies\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`predecessor_id\` integer NOT NULL,
    \`project_id\` integer NOT NULL,
    \`key\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`predecessor_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`project_id\`) REFERENCES \`task_projects\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_dependencies_task_idx\` ON \`task_dependencies\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_dependencies_predecessor_idx\` ON \`task_dependencies\` (\`predecessor_id\`);`)
  await db.run(sql`CREATE INDEX \`task_dependencies_project_idx\` ON \`task_dependencies\` (\`project_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_dependencies_key_idx\` ON \`task_dependencies\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_dependencies_updated_at_idx\` ON \`task_dependencies\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_dependencies_created_at_idx\` ON \`task_dependencies\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_attachments\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer,
    \`task_id\` integer,
    \`comment_id\` integer,
    \`uploader_id\` integer NOT NULL,
    \`filename\` text NOT NULL,
    \`object_key\` text NOT NULL,
    \`mime_type\` text NOT NULL,
    \`size\` numeric NOT NULL,
    \`state\` text DEFAULT 'staged',
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`comment_id\`) REFERENCES \`review_comments\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`uploader_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_attachments_board_idx\` ON \`task_attachments\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_attachments_task_idx\` ON \`task_attachments\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_attachments_comment_idx\` ON \`task_attachments\` (\`comment_id\`);`)
  await db.run(sql`CREATE INDEX \`task_attachments_uploader_idx\` ON \`task_attachments\` (\`uploader_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_attachments_object_key_idx\` ON \`task_attachments\` (\`object_key\`);`)
  await db.run(sql`CREATE INDEX \`task_attachments_state_idx\` ON \`task_attachments\` (\`state\`);`)
  await db.run(sql`CREATE INDEX \`task_attachments_updated_at_idx\` ON \`task_attachments\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_attachments_created_at_idx\` ON \`task_attachments\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_time_entries\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`user_id\` integer,
    \`field_id\` integer,
    \`started_at\` text NOT NULL,
    \`ended_at\` text,
    \`seconds\` numeric DEFAULT 0,
    \`note\` text,
    \`history\` text,
    \`active_user_key\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`field_id\`) REFERENCES \`task_field_definitions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_time_entries_task_idx\` ON \`task_time_entries\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_time_entries_user_idx\` ON \`task_time_entries\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`task_time_entries_field_idx\` ON \`task_time_entries\` (\`field_id\`);`)
  await db.run(sql`CREATE INDEX \`task_time_entries_started_at_idx\` ON \`task_time_entries\` (\`started_at\`);`)
  await db.run(sql`CREATE INDEX \`task_time_entries_ended_at_idx\` ON \`task_time_entries\` (\`ended_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_time_entries_active_user_key_idx\` ON \`task_time_entries\` (\`active_user_key\`);`)
  await db.run(sql`CREATE INDEX \`task_time_entries_updated_at_idx\` ON \`task_time_entries\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_time_entries_created_at_idx\` ON \`task_time_entries\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_countdowns\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`task_id\` integer NOT NULL,
    \`user_id\` integer,
    \`field_id\` integer NOT NULL,
    \`key\` text,
    \`ends_at\` text,
    \`remaining_seconds\` numeric,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`task_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`field_id\`) REFERENCES \`task_field_definitions\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_countdowns_task_idx\` ON \`task_countdowns\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_countdowns_user_idx\` ON \`task_countdowns\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`task_countdowns_field_idx\` ON \`task_countdowns\` (\`field_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_countdowns_key_idx\` ON \`task_countdowns\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_countdowns_updated_at_idx\` ON \`task_countdowns\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_countdowns_created_at_idx\` ON \`task_countdowns\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_capacities\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`user_id\` integer,
    \`user_key\` text,
    \`weekly_hours\` numeric DEFAULT 40,
    \`weekdays\` text DEFAULT '[1,2,3,4,5]',
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_capacities_user_idx\` ON \`task_capacities\` (\`user_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_capacities_user_key_idx\` ON \`task_capacities\` (\`user_key\`);`)
  await db.run(sql`CREATE INDEX \`task_capacities_updated_at_idx\` ON \`task_capacities\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_capacities_created_at_idx\` ON \`task_capacities\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_board_messages\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`author_id\` integer,
    \`parent_id\` integer,
    \`body\` text NOT NULL,
    \`mentions\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`author_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`task_board_messages\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_board_messages_board_idx\` ON \`task_board_messages\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_messages_author_idx\` ON \`task_board_messages\` (\`author_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_messages_parent_idx\` ON \`task_board_messages\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`task_board_messages_updated_at_idx\` ON \`task_board_messages\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_board_messages_created_at_idx\` ON \`task_board_messages\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_message_followers\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`thread_id\` integer NOT NULL,
    \`user_id\` integer,
    \`key\` text,
    \`following\` integer DEFAULT true,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`thread_id\`) REFERENCES \`task_board_messages\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_message_followers_thread_idx\` ON \`task_message_followers\` (\`thread_id\`);`)
  await db.run(sql`CREATE INDEX \`task_message_followers_user_idx\` ON \`task_message_followers\` (\`user_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`task_message_followers_key_idx\` ON \`task_message_followers\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`task_message_followers_updated_at_idx\` ON \`task_message_followers\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_message_followers_created_at_idx\` ON \`task_message_followers\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_project_changes\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`board_id\` integer NOT NULL,
    \`destination_id\` integer NOT NULL,
    \`inherit_project\` integer,
    \`requester_id\` integer NOT NULL,
    \`fingerprint\` text,
    \`state\` text DEFAULT 'pending',
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (\`board_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`destination_id\`) REFERENCES \`task_projects\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`requester_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_project_changes_board_idx\` ON \`task_project_changes\` (\`board_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_destination_idx\` ON \`task_project_changes\` (\`destination_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_requester_idx\` ON \`task_project_changes\` (\`requester_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_state_idx\` ON \`task_project_changes\` (\`state\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_updated_at_idx\` ON \`task_project_changes\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_created_at_idx\` ON \`task_project_changes\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_project_changes_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`users_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`task_project_changes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`task_project_changes_rels_order_idx\` ON \`task_project_changes_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_rels_parent_idx\` ON \`task_project_changes_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_rels_path_idx\` ON \`task_project_changes_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`task_project_changes_rels_users_id_idx\` ON \`task_project_changes_rels\` (\`users_id\`);`)
  await db.run(sql`ALTER TABLE \`review_tasks\` ADD \`start_date\` text;`)
  await db.run(sql`ALTER TABLE \`review_tasks\` ADD \`milestone\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`task_boards\` ADD \`project_id\` integer REFERENCES task_projects(id);`)
  await db.run(sql`ALTER TABLE \`task_boards\` ADD \`inherit_project\` integer DEFAULT false;`)
  await db.run(sql`CREATE INDEX \`task_boards_project_idx\` ON \`task_boards\` (\`project_id\`);`)
  await db.run(sql`CREATE INDEX \`task_boards_inherit_project_idx\` ON \`task_boards\` (\`inherit_project\`);`)
  await db.run(sql`ALTER TABLE \`task_board_preferences\` ADD \`view_instance_id\` integer REFERENCES task_views(id);`)
  await db.run(sql`ALTER TABLE \`task_board_preferences\` ADD \`view_settings\` text;`)
  await db.run(sql`CREATE INDEX \`task_board_preferences_view_instance_idx\` ON \`task_board_preferences\` (\`view_instance_id\`);`)
  await db.run(sql`ALTER TABLE \`task_notifications\` ADD \`project_id\` integer REFERENCES task_projects(id);`)
  await db.run(sql`ALTER TABLE \`task_notifications\` ADD \`thread_id\` integer REFERENCES task_board_messages(id);`)
  await db.run(sql`ALTER TABLE \`task_notifications\` ADD \`project_change_id\` integer REFERENCES task_project_changes(id);`)
  await db.run(sql`CREATE INDEX \`task_notifications_project_idx\` ON \`task_notifications\` (\`project_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_thread_idx\` ON \`task_notifications\` (\`thread_id\`);`)
  await db.run(sql`CREATE INDEX \`task_notifications_project_change_idx\` ON \`task_notifications\` (\`project_change_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_projects_id\` integer REFERENCES task_projects(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_project_memberships_id\` integer REFERENCES task_project_memberships(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_project_preferences_id\` integer REFERENCES task_project_preferences(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_views_id\` integer REFERENCES task_views(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_board_fields_id\` integer REFERENCES task_board_fields(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_board_pages_id\` integer REFERENCES task_board_pages(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_baselines_id\` integer REFERENCES task_baselines(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_field_definitions_id\` integer REFERENCES task_field_definitions(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_field_values_id\` integer REFERENCES task_field_values(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_dependencies_id\` integer REFERENCES task_dependencies(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_attachments_id\` integer REFERENCES task_attachments(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_time_entries_id\` integer REFERENCES task_time_entries(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_countdowns_id\` integer REFERENCES task_countdowns(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_capacities_id\` integer REFERENCES task_capacities(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_board_messages_id\` integer REFERENCES task_board_messages(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_message_followers_id\` integer REFERENCES task_message_followers(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`task_project_changes_id\` integer REFERENCES task_project_changes(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_projects_id_idx\` ON \`payload_locked_documents_rels\` (\`task_projects_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_project_memberships_i_idx\` ON \`payload_locked_documents_rels\` (\`task_project_memberships_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_project_preferences_i_idx\` ON \`payload_locked_documents_rels\` (\`task_project_preferences_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_views_id_idx\` ON \`payload_locked_documents_rels\` (\`task_views_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_fields_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_fields_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_pages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_baselines_id_idx\` ON \`payload_locked_documents_rels\` (\`task_baselines_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_field_definitions_id_idx\` ON \`payload_locked_documents_rels\` (\`task_field_definitions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_field_values_id_idx\` ON \`payload_locked_documents_rels\` (\`task_field_values_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_dependencies_id_idx\` ON \`payload_locked_documents_rels\` (\`task_dependencies_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_attachments_id_idx\` ON \`payload_locked_documents_rels\` (\`task_attachments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_time_entries_id_idx\` ON \`payload_locked_documents_rels\` (\`task_time_entries_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_countdowns_id_idx\` ON \`payload_locked_documents_rels\` (\`task_countdowns_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_capacities_id_idx\` ON \`payload_locked_documents_rels\` (\`task_capacities_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_messages_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_messages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_message_followers_id_idx\` ON \`payload_locked_documents_rels\` (\`task_message_followers_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_project_changes_id_idx\` ON \`payload_locked_documents_rels\` (\`task_project_changes_id\`);`)
  await db.run(sql`ALTER TABLE \`system_settings\` ADD \`workspace_embed_origins\` text DEFAULT '[]';`)
  // Organize existing boards without changing their membership or audience.
  await db.run(sql`INSERT INTO task_projects(name,description,owner_id,visibility,archived)
    SELECT 'My projects','Your existing boards, with their original access preserved.',owner_id,'private',0
    FROM task_boards GROUP BY owner_id;`)
  await db.run(sql`UPDATE task_boards SET project_id=(SELECT min(id) FROM task_projects WHERE task_projects.owner_id=task_boards.owner_id),inherit_project=0 WHERE project_id IS NULL;`)
  await db.run(sql`INSERT INTO task_field_definitions(name,kind,creator_id,configuration,archived,system_key)
    VALUES('Estimated hours','number',(SELECT id FROM users ORDER BY id LIMIT 1),' {"precision":2}',0,'estimated-hours');`)
  await db.run(sql`INSERT INTO task_board_fields(board_id,field_id,position,key)
    SELECT b.id,f.id,0,CAST(b.id AS TEXT)||':'||CAST(f.id AS TEXT) FROM task_boards b JOIN task_field_definitions f ON f.system_key='estimated-hours';`)
  await db.run(sql`INSERT INTO task_views(board_id,name,kind,position,default_view) SELECT id,'Overview','overview',0,0 FROM task_boards;`)
  await db.run(sql`INSERT INTO task_views(board_id,name,kind,position,default_view) SELECT id,'List','list',1,1 FROM task_boards;`)
  await db.run(sql`INSERT INTO task_views(board_id,name,kind,position,default_view) SELECT id,'Board','board',2,0 FROM task_boards;`)
  await db.run(sql`INSERT INTO task_views(board_id,name,kind,position,default_view) SELECT id,'Calendar','calendar',3,0 FROM task_boards;`)
  await db.run(sql`INSERT INTO task_views(board_id,name,kind,position,default_view) SELECT id,'Files','files',4,0 FROM task_boards;`)
  await db.run(sql`UPDATE task_board_preferences SET view_instance_id=(SELECT id FROM task_views WHERE task_views.board_id=task_board_preferences.board_id AND task_views.kind=task_board_preferences.view LIMIT 1);`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('This additive workspace migration preserves collaboration history. Restore an approved Cloudflare recovery point instead of dropping workspace data.')
}
