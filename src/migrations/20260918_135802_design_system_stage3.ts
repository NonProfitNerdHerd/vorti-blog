import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`posts\` ADD \`design_template_id\` integer REFERENCES design_templates(id);`)
  await db.run(sql`ALTER TABLE \`posts\` ADD \`template_values\` text;`)
  await db.run(sql`ALTER TABLE \`posts\` ADD \`design_overrides\` text;`)
  await db.run(sql`CREATE INDEX \`posts_design_template_idx\` ON \`posts\` (\`design_template_id\`);`)
  await db.run(sql`ALTER TABLE \`_posts_v\` ADD \`version_design_template_id\` integer REFERENCES design_templates(id);`)
  await db.run(sql`ALTER TABLE \`_posts_v\` ADD \`version_template_values\` text;`)
  await db.run(sql`ALTER TABLE \`_posts_v\` ADD \`version_design_overrides\` text;`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_design_template_idx\` ON \`_posts_v\` (\`version_design_template_id\`);`)
  await db.run(sql`ALTER TABLE \`design_templates_sections\` ADD \`block_type_id\` integer REFERENCES design_block_types(id);`)
  await db.run(sql`UPDATE \`design_templates_sections\` SET \`block_type_id\` = (SELECT \`block_type_id\` FROM \`design_block_designs\` WHERE \`design_block_designs\`.\`id\` = \`design_templates_sections\`.\`block_design_id\`) WHERE \`block_design_id\` IS NOT NULL;`)
  await db.run(sql`CREATE INDEX \`design_templates_sections_block_type_idx\` ON \`design_templates_sections\` (\`block_type_id\`);`)
  await db.run(sql`ALTER TABLE \`_design_templates_v_version_sections\` ADD \`block_type_id\` integer REFERENCES design_block_types(id);`)
  await db.run(sql`UPDATE \`_design_templates_v_version_sections\` SET \`block_type_id\` = (SELECT \`block_type_id\` FROM \`design_block_designs\` WHERE \`design_block_designs\`.\`id\` = \`_design_templates_v_version_sections\`.\`block_design_id\`) WHERE \`block_design_id\` IS NOT NULL;`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_sections_block_type_idx\` ON \`_design_templates_v_version_sections\` (\`block_type_id\`);`)
  const heroType = await payload.find({ collection: 'design-block-types', where: { slug: { equals: 'hero-board' } }, limit: 1, depth: 0, overrideAccess: true, req })
  const feature = await payload.find({ collection: 'design-block-designs', where: { slug: { equals: 'hero-board-feature' } }, limit: 1, depth: 0, overrideAccess: true, req })
  if (!heroType.docs[0] || !feature.docs[0]) throw new Error('Stage 3 requires the Stage 2 Hero Board seed')
  await payload.create({ collection: 'design-templates', overrideAccess: true, req, data: {
    name: 'Standard Article', slug: 'standard-article', status: 'published', _status: 'published', allowedCollections: ['posts'],
    sections: [{ key: 'hero', name: 'Hero', blockType: heroType.docs[0].id, blockDesign: feature.docs[0].id, required: true, allowDesignOverride: true }],
  } })
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await payload.delete({ collection: 'design-templates', where: { slug: { equals: 'standard-article' } }, overrideAccess: true, req })
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_posts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text,
  	\`slug\` text,
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
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`featured_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`author_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`meta_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_posts\`("id", "title", "slug", "excerpt", "content", "featured_image_id", "author_id", "published_at", "featured", "allow_comments", "meta_title", "meta_description", "meta_image_id", "updated_at", "created_at", "_status") SELECT "id", "title", "slug", "excerpt", "content", "featured_image_id", "author_id", "published_at", "featured", "allow_comments", "meta_title", "meta_description", "meta_image_id", "updated_at", "created_at", "_status" FROM \`posts\`;`)
  await db.run(sql`DROP TABLE \`posts\`;`)
  await db.run(sql`ALTER TABLE \`__new_posts\` RENAME TO \`posts\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE UNIQUE INDEX \`posts_slug_idx\` ON \`posts\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`posts_featured_image_idx\` ON \`posts\` (\`featured_image_id\`);`)
  await db.run(sql`CREATE INDEX \`posts_author_idx\` ON \`posts\` (\`author_id\`);`)
  await db.run(sql`CREATE INDEX \`posts_meta_meta_image_idx\` ON \`posts\` (\`meta_image_id\`);`)
  await db.run(sql`CREATE INDEX \`posts_updated_at_idx\` ON \`posts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`posts_created_at_idx\` ON \`posts\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`posts__status_idx\` ON \`posts\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`__new__posts_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_title\` text,
  	\`version_slug\` text,
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
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`posts\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_featured_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_author_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_meta_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new__posts_v\`("id", "parent_id", "version_title", "version_slug", "version_excerpt", "version_content", "version_featured_image_id", "version_author_id", "version_published_at", "version_featured", "version_allow_comments", "version_meta_title", "version_meta_description", "version_meta_image_id", "version_updated_at", "version_created_at", "version__status", "created_at", "updated_at", "latest") SELECT "id", "parent_id", "version_title", "version_slug", "version_excerpt", "version_content", "version_featured_image_id", "version_author_id", "version_published_at", "version_featured", "version_allow_comments", "version_meta_title", "version_meta_description", "version_meta_image_id", "version_updated_at", "version_created_at", "version__status", "created_at", "updated_at", "latest" FROM \`_posts_v\`;`)
  await db.run(sql`DROP TABLE \`_posts_v\`;`)
  await db.run(sql`ALTER TABLE \`__new__posts_v\` RENAME TO \`_posts_v\`;`)
  await db.run(sql`CREATE INDEX \`_posts_v_parent_idx\` ON \`_posts_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_slug_idx\` ON \`_posts_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_featured_image_idx\` ON \`_posts_v\` (\`version_featured_image_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_author_idx\` ON \`_posts_v\` (\`version_author_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_meta_version_meta_image_idx\` ON \`_posts_v\` (\`version_meta_image_id\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_updated_at_idx\` ON \`_posts_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version_created_at_idx\` ON \`_posts_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_version_version__status_idx\` ON \`_posts_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_created_at_idx\` ON \`_posts_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_updated_at_idx\` ON \`_posts_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_posts_v_latest_idx\` ON \`_posts_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`__new_design_templates_sections\` (
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
  await db.run(sql`INSERT INTO \`__new_design_templates_sections\`("_order", "_parent_id", "id", "key", "name", "block_design_id", "required", "allow_design_override") SELECT "_order", "_parent_id", "id", "key", "name", "block_design_id", "required", "allow_design_override" FROM \`design_templates_sections\`;`)
  await db.run(sql`DROP TABLE \`design_templates_sections\`;`)
  await db.run(sql`ALTER TABLE \`__new_design_templates_sections\` RENAME TO \`design_templates_sections\`;`)
  await db.run(sql`CREATE INDEX \`design_templates_sections_order_idx\` ON \`design_templates_sections\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`design_templates_sections_parent_id_idx\` ON \`design_templates_sections\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`design_templates_sections_block_design_idx\` ON \`design_templates_sections\` (\`block_design_id\`);`)
  await db.run(sql`CREATE TABLE \`__new__design_templates_v_version_sections\` (
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
  await db.run(sql`INSERT INTO \`__new__design_templates_v_version_sections\`("_order", "_parent_id", "id", "key", "name", "block_design_id", "required", "allow_design_override", "_uuid") SELECT "_order", "_parent_id", "id", "key", "name", "block_design_id", "required", "allow_design_override", "_uuid" FROM \`_design_templates_v_version_sections\`;`)
  await db.run(sql`DROP TABLE \`_design_templates_v_version_sections\`;`)
  await db.run(sql`ALTER TABLE \`__new__design_templates_v_version_sections\` RENAME TO \`_design_templates_v_version_sections\`;`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_sections_order_idx\` ON \`_design_templates_v_version_sections\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_sections_parent_id_idx\` ON \`_design_templates_v_version_sections\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_design_templates_v_version_sections_block_design_idx\` ON \`_design_templates_v_version_sections\` (\`block_design_id\`);`)
}
