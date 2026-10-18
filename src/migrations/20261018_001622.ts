import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`system_settings_tag_management_roles\` (
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`value\` text,
    \`id\` integer PRIMARY KEY NOT NULL,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`system_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`system_settings_tag_management_roles_order_idx\` ON \`system_settings_tag_management_roles\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`system_settings_tag_management_roles_parent_idx\` ON \`system_settings_tag_management_roles\` (\`parent_id\`);`)
  await db.run(sql`INSERT INTO system_settings_tag_management_roles (\`order\`, parent_id, value) SELECT 1, id, 'administrator' FROM system_settings UNION ALL SELECT 2, id, 'designer' FROM system_settings UNION ALL SELECT 3, id, 'editor' FROM system_settings;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`timezone\` text DEFAULT 'UTC';`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`date_format\` text DEFAULT 'long';`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`time_format\` text DEFAULT '12';`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`discourage_search_indexing\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`privacy_policy_page_id\` integer REFERENCES pages(id) ON DELETE SET NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`show_privacy_policy_link\` integer DEFAULT false;`)
  await db.run(sql`CREATE INDEX \`site_settings_privacy_policy_page_idx\` ON \`site_settings\` (\`privacy_policy_page_id\`);`)
  await db.run(sql`INSERT INTO site_settings (id, site_name, timezone, date_format, time_format, discourage_search_indexing, show_privacy_policy_link, created_at, updated_at) SELECT 1, 'Vorti Blog', 'UTC', 'long', '12', false, false, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE NOT EXISTS (SELECT 1 FROM site_settings);`)

}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`system_settings_tag_management_roles\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_site_settings\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`site_name\` text NOT NULL,
    \`site_tagline\` text,
    \`site_description\` text,
    \`logo_id\` integer,
    \`dark_logo_id\` integer,
    \`favicon_id\` integer,
    \`homepage_id\` integer,
    \`blog_page_id\` integer,
    \`default_site_template_id\` integer,
    \`primary_color\` text,
    \`secondary_color\` text,
    \`accent_color\` text,
    \`default_seo_title\` text,
    \`default_seo_description\` text,
    \`default_social_image_id\` integer,
    \`twitter_u_r_l\` text,
    \`youtube_u_r_l\` text,
    \`facebook_u_r_l\` text,
    \`instagram_u_r_l\` text,
    \`discord_u_r_l\` text,
    \`github_u_r_l\` text,
    \`footer_description\` text,
    \`copyright_text\` text,
    \`contact_email\` text,
    \`contact_information\` text,
    \`updated_at\` text,
    \`created_at\` text,
    FOREIGN KEY (\`logo_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`dark_logo_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`favicon_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`homepage_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`blog_page_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`default_site_template_id\`) REFERENCES \`site_tpl\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`default_social_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_site_settings\`("id", "site_name", "site_tagline", "site_description", "logo_id", "dark_logo_id", "favicon_id", "homepage_id", "blog_page_id", "default_site_template_id", "primary_color", "secondary_color", "accent_color", "default_seo_title", "default_seo_description", "default_social_image_id", "twitter_u_r_l", "youtube_u_r_l", "facebook_u_r_l", "instagram_u_r_l", "discord_u_r_l", "github_u_r_l", "footer_description", "copyright_text", "contact_email", "contact_information", "updated_at", "created_at") SELECT "id", "site_name", "site_tagline", "site_description", "logo_id", "dark_logo_id", "favicon_id", "homepage_id", "blog_page_id", "default_site_template_id", "primary_color", "secondary_color", "accent_color", "default_seo_title", "default_seo_description", "default_social_image_id", "twitter_u_r_l", "youtube_u_r_l", "facebook_u_r_l", "instagram_u_r_l", "discord_u_r_l", "github_u_r_l", "footer_description", "copyright_text", "contact_email", "contact_information", "updated_at", "created_at" FROM \`site_settings\`;`)
  await db.run(sql`DROP TABLE \`site_settings\`;`)
  await db.run(sql`ALTER TABLE \`__new_site_settings\` RENAME TO \`site_settings\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`site_settings_logo_idx\` ON \`site_settings\` (\`logo_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_dark_logo_idx\` ON \`site_settings\` (\`dark_logo_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_favicon_idx\` ON \`site_settings\` (\`favicon_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_homepage_idx\` ON \`site_settings\` (\`homepage_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_blog_page_idx\` ON \`site_settings\` (\`blog_page_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_default_site_template_idx\` ON \`site_settings\` (\`default_site_template_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_default_social_image_idx\` ON \`site_settings\` (\`default_social_image_id\`);`)
}
