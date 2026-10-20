import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db: connection }: MigrateUpArgs): Promise<void> {
  const statements: Parameters<typeof connection.run>[0][] = []
  const db = {
    all: connection.all.bind(connection) as typeof connection.all,
    run: async (statement: Parameters<typeof connection.run>[0]) => { statements.push(statement) },
  }
  const flush = async () => {
    // D1 cannot disable foreign keys between queries. Keep reconstruction and
    // relationship restoration in one native batch/implicit transaction.
    const batchConnection = connection as unknown as { batch?: (queries: unknown[]) => Promise<unknown> }
    if (batchConnection.batch) await batchConnection.batch(statements.map(statement => connection.run(statement)))
    else for (const statement of statements) await connection.run(statement)
  }
  const postColumns = await db.all<{ name: string }>(sql`PRAGMA table_info(posts);`)
  const lockColumns = await db.all<{ name: string }>(sql`PRAGMA table_info(payload_locked_documents_rels);`)
  // Older development databases already lack the retired relationships. Avoid
  // rebuilding their shared tables or pretending unrelated upgrades were applied.
  if (!postColumns.some(column => column.name === 'post_type_id') && !lockColumns.some(column => column.name === 'post_types_id')) {
    if (!postColumns.some(column => column.name === 'template_snapshot')) await db.run(sql`ALTER TABLE posts ADD template_snapshot text;`)
    if (!postColumns.some(column => column.name === 'event')) await db.run(sql`ALTER TABLE posts ADD event text;`)
    const versions = await db.all<{ name: string }>(sql`PRAGMA table_info(_posts_v);`)
    if (!versions.some(column => column.name === 'version_template_snapshot')) await db.run(sql`ALTER TABLE _posts_v ADD version_template_snapshot text;`)
    if (!versions.some(column => column.name === 'version_event')) await db.run(sql`ALTER TABLE _posts_v ADD version_event text;`)
    await db.run(sql`DROP TABLE IF EXISTS _post_types_v_rels;`)
    await db.run(sql`DROP TABLE IF EXISTS _post_types_v;`)
    await db.run(sql`DROP TABLE IF EXISTS post_types_rels;`)
    await db.run(sql`DROP TABLE IF EXISTS post_types;`)
    await flush()
    return
  }
  // Preserve every affected relationship, including non-CMS editing locks.
  await db.run(sql`CREATE TABLE __cms_backup_posts_rels AS SELECT * FROM posts_rels;`)
  await db.run(sql`CREATE TABLE __cms_backup__posts_v AS SELECT * FROM _posts_v;`)
  await db.run(sql`CREATE TABLE __cms_backup__posts_v_rels AS SELECT * FROM _posts_v_rels;`)
  await db.run(sql`CREATE TABLE __cms_backup_event_series AS SELECT * FROM event_series;`)
  await db.run(sql`CREATE TABLE __cms_backup_search_rels AS SELECT * FROM search_rels;`)
  await db.run(sql`CREATE TABLE __cms_backup_redirects_rels AS SELECT * FROM redirects_rels;`)
  await db.run(sql`CREATE TABLE __cms_backup_payload_locked_documents_rels AS SELECT * FROM payload_locked_documents_rels WHERE post_types_id IS NULL;`)
  await db.run(sql`DELETE FROM event_series;`)
  await db.run(sql`PRAGMA defer_foreign_keys=ON;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_posts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text,
    \`slug\` text,
    \`responsive_designs\` text DEFAULT '{}',
    \`template_snapshot\` text,
    \`design_template_id\` integer,
    \`template_values\` text,
    \`excerpt\` text,
    \`content\` text,
    \`featured_image_id\` integer,
    \`author_id\` integer,
    \`published_at\` text,
    \`featured\` integer DEFAULT false,
    \`allow_comments\` integer DEFAULT false,
    \`meta_title\` text,
    \`meta_description\` text,
    \`meta_image_id\` integer,
    \`design_overrides\` text DEFAULT '{}',
    \`form_action_key\` text,
    \`event\` text,
    \`content_layout\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`_status\` text DEFAULT 'draft',
    FOREIGN KEY (\`design_template_id\`) REFERENCES \`design_templates\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`featured_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`author_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`meta_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_posts\`("id", "title", "slug", "responsive_designs", "template_snapshot", "design_template_id", "template_values", "excerpt", "content", "featured_image_id", "author_id", "published_at", "featured", "allow_comments", "meta_title", "meta_description", "meta_image_id", "design_overrides", "form_action_key", "event", "content_layout", "updated_at", "created_at", "_status") SELECT "id", "title", "slug", "responsive_designs", NULL, "design_template_id", "template_values", "excerpt", "content", "featured_image_id", "author_id", "published_at", "featured", "allow_comments", "meta_title", "meta_description", "meta_image_id", "design_overrides", "form_action_key", NULL, "content_layout", "updated_at", "created_at", "_status" FROM \`posts\`;`)
  await db.run(sql`DROP TABLE \`posts\`;`)
  await db.run(sql`ALTER TABLE \`__new_posts\` RENAME TO \`posts\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE UNIQUE INDEX \`posts_slug_idx\` ON \`posts\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`posts_design_template_idx\` ON \`posts\` (\`design_template_id\`);`)
  await db.run(sql`CREATE INDEX \`posts_featured_image_idx\` ON \`posts\` (\`featured_image_id\`);`)
  await db.run(sql`CREATE INDEX \`posts_author_idx\` ON \`posts\` (\`author_id\`);`)
  await db.run(sql`CREATE INDEX \`posts_meta_meta_image_idx\` ON \`posts\` (\`meta_image_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`posts_form_action_key_idx\` ON \`posts\` (\`form_action_key\`);`)
  await db.run(sql`CREATE INDEX \`posts_updated_at_idx\` ON \`posts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`posts_created_at_idx\` ON \`posts\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`posts__status_idx\` ON \`posts\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`__new__posts_v\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`parent_id\` integer,
    \`version_title\` text,
    \`version_slug\` text,
    \`version_responsive_designs\` text DEFAULT '{}',
    \`version_template_snapshot\` text,
    \`version_design_template_id\` integer,
    \`version_template_values\` text,
    \`version_excerpt\` text,
    \`version_content\` text,
    \`version_featured_image_id\` integer,
    \`version_author_id\` integer,
    \`version_published_at\` text,
    \`version_featured\` integer DEFAULT false,
    \`version_allow_comments\` integer DEFAULT false,
    \`version_meta_title\` text,
    \`version_meta_description\` text,
    \`version_meta_image_id\` integer,
    \`version_design_overrides\` text DEFAULT '{}',
    \`version_form_action_key\` text,
    \`version_event\` text,
    \`version_content_layout\` text,
    \`version_updated_at\` text,
    \`version_created_at\` text,
    \`version__status\` text DEFAULT 'draft',
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`latest\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`posts\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_design_template_id\`) REFERENCES \`design_templates\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_featured_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_author_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`version_meta_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new__posts_v\`("id", "parent_id", "version_title", "version_slug", "version_responsive_designs", "version_template_snapshot", "version_design_template_id", "version_template_values", "version_excerpt", "version_content", "version_featured_image_id", "version_author_id", "version_published_at", "version_featured", "version_allow_comments", "version_meta_title", "version_meta_description", "version_meta_image_id", "version_design_overrides", "version_form_action_key", "version_event", "version_content_layout", "version_updated_at", "version_created_at", "version__status", "created_at", "updated_at", "latest") SELECT "id", "parent_id", "version_title", "version_slug", "version_responsive_designs", NULL, "version_design_template_id", "version_template_values", "version_excerpt", "version_content", "version_featured_image_id", "version_author_id", "version_published_at", "version_featured", "version_allow_comments", "version_meta_title", "version_meta_description", "version_meta_image_id", "version_design_overrides", "version_form_action_key", NULL, "version_content_layout", "version_updated_at", "version_created_at", "version__status", "created_at", "updated_at", "latest" FROM \`__cms_backup__posts_v\`;`)
  await db.run(sql`DROP TABLE \`_posts_v\`;`)
  await db.run(sql`ALTER TABLE \`__new__posts_v\` RENAME TO \`_posts_v\`;`)
  await db.run(sql`CREATE INDEX \`_posts_v_parent_idx\` ON \`_posts_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_slug_idx\` ON \`_posts_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_design_template_idx\` ON \`_posts_v\` (\`version_design_template_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_featured_image_idx\` ON \`_posts_v\` (\`version_featured_image_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_author_idx\` ON \`_posts_v\` (\`version_author_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_meta_version_meta_image_idx\` ON \`_posts_v\` (\`version_meta_image_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_form_action_key_idx\` ON \`_posts_v\` (\`version_form_action_key\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_updated_at_idx\` ON \`_posts_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_created_at_idx\` ON \`_posts_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version__status_idx\` ON \`_posts_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_created_at_idx\` ON \`_posts_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_updated_at_idx\` ON \`_posts_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_latest_idx\` ON \`_posts_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`posts_id\` integer,
    \`pages_id\` integer,
    \`categories_id\` integer,
    \`tags_id\` integer,
    \`media_id\` integer,
    \`site_tpl_id\` integer,
    \`users_id\` integer,
    \`menus_id\` integer,
    \`review_tasks_id\` integer,
    \`review_comments_id\` integer,
    \`review_activity_id\` integer,
    \`task_boards_id\` integer,
    \`task_board_memberships_id\` integer,
    \`task_sections_id\` integer,
    \`task_placements_id\` integer,
    \`task_followers_id\` integer,
    \`task_board_preferences_id\` integer,
    \`task_sharing_requests_id\` integer,
    \`task_notifications_id\` integer,
    \`task_board_activity_id\` integer,
    \`task_projects_id\` integer,
    \`task_project_memberships_id\` integer,
    \`task_project_preferences_id\` integer,
    \`task_views_id\` integer,
    \`task_board_fields_id\` integer,
    \`task_board_pages_id\` integer,
    \`task_baselines_id\` integer,
    \`task_field_definitions_id\` integer,
    \`task_field_values_id\` integer,
    \`task_dependencies_id\` integer,
    \`task_attachments_id\` integer,
    \`task_time_entries_id\` integer,
    \`task_time_audit_id\` integer,
    \`task_countdowns_id\` integer,
    \`task_capacities_id\` integer,
    \`task_board_messages_id\` integer,
    \`task_message_followers_id\` integer,
    \`task_project_changes_id\` integer,
    \`task_notification_events_id\` integer,
    \`saved_views_id\` integer,
    \`event_series_id\` integer,
    \`design_block_types_id\` integer,
    \`design_block_designs_id\` integer,
    \`design_templates_id\` integer,
    \`search_id\` integer,
    \`redirects_id\` integer,
    \`form_contacts_id\` integer,
    \`form_support_requests_id\` integer,
    \`form_revisions_id\` integer,
    \`form_drafts_id\` integer,
    \`form_attachments_id\` integer,
    \`form_outbox_id\` integer,
    \`form_audit_id\` integer,
    \`form_analytics_id\` integer,
    \`form_deliveries_id\` integer,
    \`form_resources_id\` integer,
    \`form_templates_id\` integer,
    \`form_integrations_id\` integer,
    \`form_exports_id\` integer,
    \`forms_id\` integer,
    \`form_submissions_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`posts_id\`) REFERENCES \`posts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`pages_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`categories_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`tags_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`site_tpl_id\`) REFERENCES \`site_tpl\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`menus_id\`) REFERENCES \`menus\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`review_tasks_id\`) REFERENCES \`review_tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`review_comments_id\`) REFERENCES \`review_comments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`review_activity_id\`) REFERENCES \`review_activity\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_boards_id\`) REFERENCES \`task_boards\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_board_memberships_id\`) REFERENCES \`task_board_memberships\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_sections_id\`) REFERENCES \`task_sections\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_placements_id\`) REFERENCES \`task_placements\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_followers_id\`) REFERENCES \`task_followers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_board_preferences_id\`) REFERENCES \`task_board_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_sharing_requests_id\`) REFERENCES \`task_sharing_requests\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_notifications_id\`) REFERENCES \`task_notifications\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_board_activity_id\`) REFERENCES \`task_board_activity\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_projects_id\`) REFERENCES \`task_projects\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_project_memberships_id\`) REFERENCES \`task_project_memberships\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_project_preferences_id\`) REFERENCES \`task_project_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_views_id\`) REFERENCES \`task_views\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_board_fields_id\`) REFERENCES \`task_board_fields\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_board_pages_id\`) REFERENCES \`task_board_pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_baselines_id\`) REFERENCES \`task_baselines\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_field_definitions_id\`) REFERENCES \`task_field_definitions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_field_values_id\`) REFERENCES \`task_field_values\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_dependencies_id\`) REFERENCES \`task_dependencies\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_attachments_id\`) REFERENCES \`task_attachments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_time_entries_id\`) REFERENCES \`task_time_entries\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_time_audit_id\`) REFERENCES \`task_time_audit\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_countdowns_id\`) REFERENCES \`task_countdowns\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_capacities_id\`) REFERENCES \`task_capacities\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_board_messages_id\`) REFERENCES \`task_board_messages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_message_followers_id\`) REFERENCES \`task_message_followers\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_project_changes_id\`) REFERENCES \`task_project_changes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`task_notification_events_id\`) REFERENCES \`task_notification_events\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`saved_views_id\`) REFERENCES \`saved_views\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`event_series_id\`) REFERENCES \`event_series\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`design_block_types_id\`) REFERENCES \`design_block_types\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`design_block_designs_id\`) REFERENCES \`design_block_designs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`design_templates_id\`) REFERENCES \`design_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`search_id\`) REFERENCES \`search\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`redirects_id\`) REFERENCES \`redirects\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_contacts_id\`) REFERENCES \`form_contacts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_support_requests_id\`) REFERENCES \`form_support_requests\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_revisions_id\`) REFERENCES \`form_revisions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_drafts_id\`) REFERENCES \`form_drafts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_attachments_id\`) REFERENCES \`form_attachments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_outbox_id\`) REFERENCES \`form_outbox\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_audit_id\`) REFERENCES \`form_audit\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_analytics_id\`) REFERENCES \`form_analytics\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_deliveries_id\`) REFERENCES \`form_deliveries\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_resources_id\`) REFERENCES \`form_resources\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_templates_id\`) REFERENCES \`form_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_integrations_id\`) REFERENCES \`form_integrations\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_exports_id\`) REFERENCES \`form_exports\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`forms_id\`) REFERENCES \`forms\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`form_submissions_id\`) REFERENCES \`form_submissions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "posts_id", "pages_id", "categories_id", "tags_id", "media_id", "site_tpl_id", "users_id", "menus_id", "review_tasks_id", "review_comments_id", "review_activity_id", "task_boards_id", "task_board_memberships_id", "task_sections_id", "task_placements_id", "task_followers_id", "task_board_preferences_id", "task_sharing_requests_id", "task_notifications_id", "task_board_activity_id", "task_projects_id", "task_project_memberships_id", "task_project_preferences_id", "task_views_id", "task_board_fields_id", "task_board_pages_id", "task_baselines_id", "task_field_definitions_id", "task_field_values_id", "task_dependencies_id", "task_attachments_id", "task_time_entries_id", "task_time_audit_id", "task_countdowns_id", "task_capacities_id", "task_board_messages_id", "task_message_followers_id", "task_project_changes_id", "task_notification_events_id", "saved_views_id", "event_series_id", "design_block_types_id", "design_block_designs_id", "design_templates_id", "search_id", "redirects_id", "form_contacts_id", "form_support_requests_id", "form_revisions_id", "form_drafts_id", "form_attachments_id", "form_outbox_id", "form_audit_id", "form_analytics_id", "form_deliveries_id", "form_resources_id", "form_templates_id", "form_integrations_id", "form_exports_id", "forms_id", "form_submissions_id") SELECT "id", "order", "parent_id", "path", "posts_id", "pages_id", "categories_id", "tags_id", "media_id", "site_tpl_id", "users_id", "menus_id", "review_tasks_id", "review_comments_id", "review_activity_id", "task_boards_id", "task_board_memberships_id", "task_sections_id", "task_placements_id", "task_followers_id", "task_board_preferences_id", "task_sharing_requests_id", "task_notifications_id", "task_board_activity_id", "task_projects_id", "task_project_memberships_id", "task_project_preferences_id", "task_views_id", "task_board_fields_id", "task_board_pages_id", "task_baselines_id", "task_field_definitions_id", "task_field_values_id", "task_dependencies_id", "task_attachments_id", "task_time_entries_id", "task_time_audit_id", "task_countdowns_id", "task_capacities_id", "task_board_messages_id", "task_message_followers_id", "task_project_changes_id", "task_notification_events_id", "saved_views_id", "event_series_id", "design_block_types_id", "design_block_designs_id", "design_templates_id", "search_id", "redirects_id", "form_contacts_id", "form_support_requests_id", "form_revisions_id", "form_drafts_id", "form_attachments_id", "form_outbox_id", "form_audit_id", "form_analytics_id", "form_deliveries_id", "form_resources_id", "form_templates_id", "form_integrations_id", "form_exports_id", "forms_id", "form_submissions_id" FROM \`__cms_backup_payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_posts_id_idx\` ON \`payload_locked_documents_rels\` (\`posts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`pages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_categories_id_idx\` ON \`payload_locked_documents_rels\` (\`categories_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tags_id_idx\` ON \`payload_locked_documents_rels\` (\`tags_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_site_tpl_id_idx\` ON \`payload_locked_documents_rels\` (\`site_tpl_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_menus_id_idx\` ON \`payload_locked_documents_rels\` (\`menus_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_review_tasks_id_idx\` ON \`payload_locked_documents_rels\` (\`review_tasks_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_review_comments_id_idx\` ON \`payload_locked_documents_rels\` (\`review_comments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_review_activity_id_idx\` ON \`payload_locked_documents_rels\` (\`review_activity_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_boards_id_idx\` ON \`payload_locked_documents_rels\` (\`task_boards_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_memberships_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_memberships_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_sections_id_idx\` ON \`payload_locked_documents_rels\` (\`task_sections_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_placements_id_idx\` ON \`payload_locked_documents_rels\` (\`task_placements_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_followers_id_idx\` ON \`payload_locked_documents_rels\` (\`task_followers_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_preferences_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_preferences_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_sharing_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`task_sharing_requests_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_notifications_id_idx\` ON \`payload_locked_documents_rels\` (\`task_notifications_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_activity_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_activity_id\`);`)
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
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_time_audit_id_idx\` ON \`payload_locked_documents_rels\` (\`task_time_audit_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_countdowns_id_idx\` ON \`payload_locked_documents_rels\` (\`task_countdowns_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_capacities_id_idx\` ON \`payload_locked_documents_rels\` (\`task_capacities_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_board_messages_id_idx\` ON \`payload_locked_documents_rels\` (\`task_board_messages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_message_followers_id_idx\` ON \`payload_locked_documents_rels\` (\`task_message_followers_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_project_changes_id_idx\` ON \`payload_locked_documents_rels\` (\`task_project_changes_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_notification_events_i_idx\` ON \`payload_locked_documents_rels\` (\`task_notification_events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_saved_views_id_idx\` ON \`payload_locked_documents_rels\` (\`saved_views_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_event_series_id_idx\` ON \`payload_locked_documents_rels\` (\`event_series_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_block_types_id_idx\` ON \`payload_locked_documents_rels\` (\`design_block_types_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_block_designs_id_idx\` ON \`payload_locked_documents_rels\` (\`design_block_designs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_templates_id_idx\` ON \`payload_locked_documents_rels\` (\`design_templates_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_search_id_idx\` ON \`payload_locked_documents_rels\` (\`search_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_redirects_id_idx\` ON \`payload_locked_documents_rels\` (\`redirects_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_contacts_id_idx\` ON \`payload_locked_documents_rels\` (\`form_contacts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_support_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`form_support_requests_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_revisions_id_idx\` ON \`payload_locked_documents_rels\` (\`form_revisions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_drafts_id_idx\` ON \`payload_locked_documents_rels\` (\`form_drafts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_attachments_id_idx\` ON \`payload_locked_documents_rels\` (\`form_attachments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_outbox_id_idx\` ON \`payload_locked_documents_rels\` (\`form_outbox_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_audit_id_idx\` ON \`payload_locked_documents_rels\` (\`form_audit_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_analytics_id_idx\` ON \`payload_locked_documents_rels\` (\`form_analytics_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_deliveries_id_idx\` ON \`payload_locked_documents_rels\` (\`form_deliveries_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_resources_id_idx\` ON \`payload_locked_documents_rels\` (\`form_resources_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_templates_id_idx\` ON \`payload_locked_documents_rels\` (\`form_templates_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_integrations_id_idx\` ON \`payload_locked_documents_rels\` (\`form_integrations_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_exports_id_idx\` ON \`payload_locked_documents_rels\` (\`form_exports_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_forms_id_idx\` ON \`payload_locked_documents_rels\` (\`forms_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_submissions_id_idx\` ON \`payload_locked_documents_rels\` (\`form_submissions_id\`);`)
  await db.run(sql`DROP TABLE \`_post_types_v_rels\`;`)
  await db.run(sql`DROP TABLE \`_post_types_v\`;`)
  await db.run(sql`DROP TABLE \`post_types_rels\`;`)
  await db.run(sql`DROP TABLE \`post_types\`;`)

  await db.run(sql`INSERT OR REPLACE INTO posts_rels("id","order","parent_id","path","categories_id","tags_id") SELECT "id","order","parent_id","path","categories_id","tags_id" FROM __cms_backup_posts_rels;`)
  await db.run(sql`INSERT OR REPLACE INTO _posts_v_rels("id","order","parent_id","path","categories_id","tags_id") SELECT "id","order","parent_id","path","categories_id","tags_id" FROM __cms_backup__posts_v_rels;`)
  await db.run(sql`INSERT OR REPLACE INTO event_series("id","post_id","start","end","recurring","schedule","updated_at","created_at") SELECT "id","post_id","start","end","recurring","schedule","updated_at","created_at" FROM __cms_backup_event_series;`)
  await db.run(sql`INSERT OR REPLACE INTO search_rels("id","order","parent_id","path","posts_id","pages_id") SELECT "id","order","parent_id","path","posts_id","pages_id" FROM __cms_backup_search_rels;`)
  await db.run(sql`INSERT OR REPLACE INTO redirects_rels("id","order","parent_id","path","posts_id","pages_id") SELECT "id","order","parent_id","path","posts_id","pages_id" FROM __cms_backup_redirects_rels;`)
  await db.run(sql`DROP TABLE __cms_backup_posts_rels;`)
  await db.run(sql`DROP TABLE __cms_backup__posts_v;`)
  await db.run(sql`DROP TABLE __cms_backup__posts_v_rels;`)
  await db.run(sql`DROP TABLE __cms_backup_event_series;`)
  await db.run(sql`DROP TABLE __cms_backup_search_rels;`)
  await db.run(sql`DROP TABLE __cms_backup_redirects_rels;`)
  await db.run(sql`DROP TABLE __cms_backup_payload_locked_documents_rels;`)
  await db.run(sql`PRAGMA defer_foreign_keys=OFF;`)
  await flush()
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error("Retired Post Type data cannot be recovered by a down migration. Restore the recorded database recovery point.")
}
