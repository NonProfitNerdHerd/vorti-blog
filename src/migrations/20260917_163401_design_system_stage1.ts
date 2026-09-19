import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`design_block_types_fields\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`label\` text,
  	\`kind\` text,
  	\`required\` integer,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`design_block_types\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`design_block_types_fields_order_idx\` ON \`design_block_types_fields\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`design_block_types_fields_parent_id_idx\` ON \`design_block_types_fields\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`design_block_types\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`slug\` text,
  	\`description\` text,
  	\`renderer_key\` text,
  	\`status\` text DEFAULT 'draft',
  	\`schema_version\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft'
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`design_block_types_slug_idx\` ON \`design_block_types\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`design_block_types_updated_at_idx\` ON \`design_block_types\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`design_block_types_created_at_idx\` ON \`design_block_types\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`design_block_types__status_idx\` ON \`design_block_types\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`_design_block_types_v_version_fields\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`label\` text,
  	\`kind\` text,
  	\`required\` integer,
  	\`_uuid\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`_design_block_types_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_fields_order_idx\` ON \`_design_block_types_v_version_fields\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_fields_parent_id_idx\` ON \`_design_block_types_v_version_fields\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_design_block_types_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_name\` text,
  	\`version_slug\` text,
  	\`version_description\` text,
  	\`version_renderer_key\` text,
  	\`version_status\` text DEFAULT 'draft',
  	\`version_schema_version\` numeric DEFAULT 1,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`design_block_types\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_parent_idx\` ON \`_design_block_types_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_version_slug_idx\` ON \`_design_block_types_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_version_updated_at_idx\` ON \`_design_block_types_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_version_created_at_idx\` ON \`_design_block_types_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_version__status_idx\` ON \`_design_block_types_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_created_at_idx\` ON \`_design_block_types_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_updated_at_idx\` ON \`_design_block_types_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_latest_idx\` ON \`_design_block_types_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`design_block_designs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`slug\` text,
  	\`description\` text,
  	\`block_type_id\` integer,
  	\`status\` text DEFAULT 'draft',
  	\`design_alignment\` text,
  	\`design_tone\` text,
  	\`design_spacing\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`block_type_id\`) REFERENCES \`design_block_types\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`design_block_designs_slug_idx\` ON \`design_block_designs\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`design_block_designs_block_type_idx\` ON \`design_block_designs\` (\`block_type_id\`);`)
  await db.run(sql`CREATE INDEX \`design_block_designs_updated_at_idx\` ON \`design_block_designs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`design_block_designs_created_at_idx\` ON \`design_block_designs\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`design_block_designs__status_idx\` ON \`design_block_designs\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`_design_block_designs_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_name\` text,
  	\`version_slug\` text,
  	\`version_description\` text,
  	\`version_block_type_id\` integer,
  	\`version_status\` text DEFAULT 'draft',
  	\`version_design_alignment\` text,
  	\`version_design_tone\` text,
  	\`version_design_spacing\` text,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`design_block_designs\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_block_type_id\`) REFERENCES \`design_block_types\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_parent_idx\` ON \`_design_block_designs_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_version_version_slug_idx\` ON \`_design_block_designs_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_version_version_block_type_idx\` ON \`_design_block_designs_v\` (\`version_block_type_id\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_version_version_updated_at_idx\` ON \`_design_block_designs_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_version_version_created_at_idx\` ON \`_design_block_designs_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_version_version__status_idx\` ON \`_design_block_designs_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_created_at_idx\` ON \`_design_block_designs_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_updated_at_idx\` ON \`_design_block_designs_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_designs_v_latest_idx\` ON \`_design_block_designs_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`design_templates_allowed_collections\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`design_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`design_templates_allowed_collections_order_idx\` ON \`design_templates_allowed_collections\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`design_templates_allowed_collections_parent_idx\` ON \`design_templates_allowed_collections\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`design_templates_sections\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`name\` text,
  	\`block_design_id\` integer,
  	\`required\` integer DEFAULT false,
  	\`allow_design_override\` integer DEFAULT false,
  	FOREIGN KEY (\`block_design_id\`) REFERENCES \`design_block_designs\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`design_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`design_templates_sections_order_idx\` ON \`design_templates_sections\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`design_templates_sections_parent_id_idx\` ON \`design_templates_sections\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`design_templates_sections_block_design_idx\` ON \`design_templates_sections\` (\`block_design_id\`);`)
  await db.run(sql`CREATE TABLE \`design_templates\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`slug\` text,
  	\`description\` text,
  	\`status\` text DEFAULT 'draft',
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft'
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`design_templates_slug_idx\` ON \`design_templates\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`design_templates_updated_at_idx\` ON \`design_templates\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`design_templates_created_at_idx\` ON \`design_templates\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`design_templates__status_idx\` ON \`design_templates\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`_design_templates_v_version_allowed_collections\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_design_templates_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_allowed_collections_order_idx\` ON \`_design_templates_v_version_allowed_collections\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_allowed_collections_parent_idx\` ON \`_design_templates_v_version_allowed_collections\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_design_templates_v_version_sections\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`name\` text,
  	\`block_design_id\` integer,
  	\`required\` integer DEFAULT false,
  	\`allow_design_override\` integer DEFAULT false,
  	\`_uuid\` text,
  	FOREIGN KEY (\`block_design_id\`) REFERENCES \`design_block_designs\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`_design_templates_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_sections_order_idx\` ON \`_design_templates_v_version_sections\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_sections_parent_id_idx\` ON \`_design_templates_v_version_sections\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_sections_block_design_idx\` ON \`_design_templates_v_version_sections\` (\`block_design_id\`);`)
  await db.run(sql`CREATE TABLE \`_design_templates_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_name\` text,
  	\`version_slug\` text,
  	\`version_description\` text,
  	\`version_status\` text DEFAULT 'draft',
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`design_templates\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_design_templates_v_parent_idx\` ON \`_design_templates_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_version_slug_idx\` ON \`_design_templates_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_version_updated_at_idx\` ON \`_design_templates_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_version_created_at_idx\` ON \`_design_templates_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_version__status_idx\` ON \`_design_templates_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_created_at_idx\` ON \`_design_templates_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_updated_at_idx\` ON \`_design_templates_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_latest_idx\` ON \`_design_templates_v\` (\`latest\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`design_block_types_id\` integer REFERENCES design_block_types(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`design_block_designs_id\` integer REFERENCES design_block_designs(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`design_templates_id\` integer REFERENCES design_templates(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_block_types_id_idx\` ON \`payload_locked_documents_rels\` (\`design_block_types_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_block_designs_id_idx\` ON \`payload_locked_documents_rels\` (\`design_block_designs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_templates_id_idx\` ON \`payload_locked_documents_rels\` (\`design_templates_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`design_block_types_fields\`;`)
  await db.run(sql`DROP TABLE \`design_block_types\`;`)
  await db.run(sql`DROP TABLE \`_design_block_types_v_version_fields\`;`)
  await db.run(sql`DROP TABLE \`_design_block_types_v\`;`)
  await db.run(sql`DROP TABLE \`design_block_designs\`;`)
  await db.run(sql`DROP TABLE \`_design_block_designs_v\`;`)
  await db.run(sql`DROP TABLE \`design_templates_allowed_collections\`;`)
  await db.run(sql`DROP TABLE \`design_templates_sections\`;`)
  await db.run(sql`DROP TABLE \`design_templates\`;`)
  await db.run(sql`DROP TABLE \`_design_templates_v_version_allowed_collections\`;`)
  await db.run(sql`DROP TABLE \`_design_templates_v_version_sections\`;`)
  await db.run(sql`DROP TABLE \`_design_templates_v\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
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
  	\`users_id\` integer,
  	\`search_id\` integer,
  	\`redirects_id\` integer,
  	\`forms_id\` integer,
  	\`form_submissions_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`posts_id\`) REFERENCES \`posts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`pages_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`categories_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tags_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`search_id\`) REFERENCES \`search\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`redirects_id\`) REFERENCES \`redirects\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`forms_id\`) REFERENCES \`forms\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`form_submissions_id\`) REFERENCES \`form_submissions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "posts_id", "pages_id", "categories_id", "tags_id", "media_id", "users_id", "search_id", "redirects_id", "forms_id", "form_submissions_id") SELECT "id", "order", "parent_id", "path", "posts_id", "pages_id", "categories_id", "tags_id", "media_id", "users_id", "search_id", "redirects_id", "forms_id", "form_submissions_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_posts_id_idx\` ON \`payload_locked_documents_rels\` (\`posts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`pages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_categories_id_idx\` ON \`payload_locked_documents_rels\` (\`categories_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tags_id_idx\` ON \`payload_locked_documents_rels\` (\`tags_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_search_id_idx\` ON \`payload_locked_documents_rels\` (\`search_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_redirects_id_idx\` ON \`payload_locked_documents_rels\` (\`redirects_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_forms_id_idx\` ON \`payload_locked_documents_rels\` (\`forms_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_submissions_id_idx\` ON \`payload_locked_documents_rels\` (\`form_submissions_id\`);`)
}
