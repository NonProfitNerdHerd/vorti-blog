import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  const runSchema = async (statement: Parameters<typeof db.run>[0]) => {
    try {
      await db.run(statement)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/already exists|duplicate column name/i.test(message)) throw error
    }
  }

  await runSchema(sql`CREATE TABLE \`site_tpl\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`slug\` text,
  	\`description\` text,
  	\`header_layout\` text DEFAULT '[]',
  	\`header_settings\` text DEFAULT '{"widthMode":"contained","position":"static","transparent":false}',
  	\`footer_layout\` text DEFAULT '[]',
  	\`footer_settings\` text DEFAULT '{"widthMode":"contained","position":"static","transparent":false}',
  	\`typography\` text,
  	\`colors\` text,
  	\`buttons\` text,
  	\`dimensions\` text,
  	\`mobile\` text,
  	\`additional_c_s_s\` text,
  	\`assignment_mode\` text DEFAULT 'default',
  	\`assignment_priority\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft'
  );
  `)
  await runSchema(sql`CREATE UNIQUE INDEX \`site_tpl_slug_idx\` ON \`site_tpl\` (\`slug\`);`)
  await runSchema(sql`CREATE INDEX \`site_tpl_updated_at_idx\` ON \`site_tpl\` (\`updated_at\`);`)
  await runSchema(sql`CREATE INDEX \`site_tpl_created_at_idx\` ON \`site_tpl\` (\`created_at\`);`)
  await runSchema(sql`CREATE INDEX \`site_tpl__status_idx\` ON \`site_tpl\` (\`_status\`);`)
  await runSchema(sql`CREATE TABLE \`_site_tpl_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_name\` text,
  	\`version_slug\` text,
  	\`version_description\` text,
  	\`version_header_layout\` text DEFAULT '[]',
  	\`version_header_settings\` text DEFAULT '{"widthMode":"contained","position":"static","transparent":false}',
  	\`version_footer_layout\` text DEFAULT '[]',
  	\`version_footer_settings\` text DEFAULT '{"widthMode":"contained","position":"static","transparent":false}',
  	\`version_typography\` text,
  	\`version_colors\` text,
  	\`version_buttons\` text,
  	\`version_dimensions\` text,
  	\`version_mobile\` text,
  	\`version_additional_c_s_s\` text,
  	\`version_assignment_mode\` text DEFAULT 'default',
  	\`version_assignment_priority\` numeric DEFAULT 0,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`site_tpl\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_parent_idx\` ON \`_site_tpl_v\` (\`parent_id\`);`)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_version_version_slug_idx\` ON \`_site_tpl_v\` (\`version_slug\`);`)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_version_version_updated_at_idx\` ON \`_site_tpl_v\` (\`version_updated_at\`);`)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_version_version_created_at_idx\` ON \`_site_tpl_v\` (\`version_created_at\`);`)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_version_version__status_idx\` ON \`_site_tpl_v\` (\`version__status\`);`)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_created_at_idx\` ON \`_site_tpl_v\` (\`created_at\`);`)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_updated_at_idx\` ON \`_site_tpl_v\` (\`updated_at\`);`)
  await runSchema(sql`CREATE INDEX \`_site_tpl_v_latest_idx\` ON \`_site_tpl_v\` (\`latest\`);`)
  await runSchema(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`site_tpl_id\` integer REFERENCES site_tpl(id);`)
  await runSchema(sql`CREATE INDEX \`payload_locked_documents_rels_site_tpl_id_idx\` ON \`payload_locked_documents_rels\` (\`site_tpl_id\`);`)
  await runSchema(sql`ALTER TABLE \`site_settings\` ADD \`homepage_id\` integer REFERENCES pages(id);`)
  await runSchema(sql`ALTER TABLE \`site_settings\` ADD \`blog_page_id\` integer REFERENCES pages(id);`)
  await runSchema(sql`ALTER TABLE \`site_settings\` ADD \`default_site_template_id\` integer REFERENCES site_tpl(id);`)
  await runSchema(sql`CREATE INDEX \`site_settings_homepage_idx\` ON \`site_settings\` (\`homepage_id\`);`)
  await runSchema(sql`CREATE INDEX \`site_settings_blog_page_idx\` ON \`site_settings\` (\`blog_page_id\`);`)
  await runSchema(sql`CREATE INDEX \`site_settings_default_site_template_idx\` ON \`site_settings\` (\`default_site_template_id\`);`)

  const existing = await payload.find({ collection: 'site-templates', where: { slug: { equals: 'default-website-template' } }, limit: 1, depth: 0, draft: true, overrideAccess: true, req })
  const siteTemplate = existing.docs[0] ?? await payload.create({
    collection: 'site-templates',
    data: {
      name: 'Default Website Template',
      slug: 'default-website-template',
      description: 'Compatibility Site Shell created by the Phase 4 schema migration.',
      header: {
        layout: [{
          id: 'default-header-row', type: 'layout', layout: 'row',
          style: { justification: 'space-between', alignment: 'center', gap: '1rem', padding: '1rem 0' },
          children: [
            { id: 'default-site-name', type: 'element', element: 'siteName', props: { source: 'siteSettings.siteName', htmlElement: 'span', linkToHomepage: true }, style: { fontSize: '1.2rem' } },
            { id: 'default-posts-link', type: 'element', element: 'button', props: { label: 'Posts', url: '/posts', buttonStyle: 'custom' } },
            { id: 'default-primary-navigation', type: 'element', element: 'navigation', props: { menuSource: 'primary', orientation: 'horizontal', alignment: 'left', itemSpacing: 'medium' } },
            { id: 'default-mobile-toggle', type: 'element', element: 'mobileMenuToggle', props: { text: 'Menu' } },
          ],
        }],
        settings: { widthMode: 'contained', maxWidth: 960, position: 'static', transparent: false, backgroundColor: '#122238', padding: '0 1rem' },
      },
      footer: {
        layout: [{
          id: 'default-footer-row', type: 'layout', layout: 'row',
          style: { justification: 'space-between', alignment: 'center', gap: '1rem', padding: '1rem 0' },
          children: [
            { id: 'default-copyright', type: 'element', element: 'copyright', props: { tokens: ['copyright', 'currentYear', 'siteName'] } },
            { id: 'default-footer-navigation', type: 'element', element: 'navigation', props: { menuSource: 'footer', orientation: 'horizontal', alignment: 'right', itemSpacing: 'medium' } },
          ],
        }],
        settings: { widthMode: 'contained', maxWidth: 960, position: 'static', transparent: false, backgroundColor: '#122238', padding: '0 1rem' },
      },
      typography: { bodyFont: 'system-ui, sans-serif', headingFont: 'system-ui, sans-serif', baseFontSize: 16, lineHeight: 1.5, bodyWeight: '400', letterSpacing: 0 },
      colors: { background: '#ffffff', surface: '#f7f7f7', text: '#1a1a1a', mutedText: '#666666', heading: '#111111', primary: '#18243a', secondary: '#44546a', accent: '#2563eb', border: '#dddddd', success: '#15803d', warning: '#a16207', error: '#b91c1c' },
      buttons: {},
      dimensions: { contentWidth: 760, wideWidth: 1200, fullWidth: 1440, pagePadding: '1rem', sectionSpacing: '3rem', contentSpacing: '1.5rem' },
      mobile: { breakpoint: 768, pagePadding: '1rem', sectionSpacing: '2rem', baseFontSize: 16, stackColumns: true, navigationMode: 'drawer' },
      additionalCSS: '',
      assignment: { mode: 'default', priority: 0 },
      _status: 'published',
    },
    draft: false,
    overrideAccess: true,
    req,
  })
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0, overrideAccess: true, req })
  if (!settings.defaultSiteTemplate) {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: {
        defaultSiteTemplate: siteTemplate.id,
        siteName: settings.siteName?.trim() || 'Vorti Blog',
      },
      overrideAccess: true,
      req,
    })
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`site_tpl\`;`)
  await db.run(sql`DROP TABLE \`_site_tpl_v\`;`)
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
  	\`design_block_types_id\` integer,
  	\`design_block_designs_id\` integer,
  	\`design_templates_id\` integer,
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
  	FOREIGN KEY (\`design_block_types_id\`) REFERENCES \`design_block_types\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`design_block_designs_id\`) REFERENCES \`design_block_designs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`design_templates_id\`) REFERENCES \`design_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`search_id\`) REFERENCES \`search\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`redirects_id\`) REFERENCES \`redirects\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`forms_id\`) REFERENCES \`forms\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`form_submissions_id\`) REFERENCES \`form_submissions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "posts_id", "pages_id", "categories_id", "tags_id", "media_id", "users_id", "design_block_types_id", "design_block_designs_id", "design_templates_id", "search_id", "redirects_id", "forms_id", "form_submissions_id") SELECT "id", "order", "parent_id", "path", "posts_id", "pages_id", "categories_id", "tags_id", "media_id", "users_id", "design_block_types_id", "design_block_designs_id", "design_templates_id", "search_id", "redirects_id", "forms_id", "form_submissions_id" FROM \`payload_locked_documents_rels\`;`)
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
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_block_types_id_idx\` ON \`payload_locked_documents_rels\` (\`design_block_types_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_block_designs_id_idx\` ON \`payload_locked_documents_rels\` (\`design_block_designs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_design_templates_id_idx\` ON \`payload_locked_documents_rels\` (\`design_templates_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_search_id_idx\` ON \`payload_locked_documents_rels\` (\`search_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_redirects_id_idx\` ON \`payload_locked_documents_rels\` (\`redirects_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_forms_id_idx\` ON \`payload_locked_documents_rels\` (\`forms_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_form_submissions_id_idx\` ON \`payload_locked_documents_rels\` (\`form_submissions_id\`);`)
  await db.run(sql`CREATE TABLE \`__new_site_settings\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`site_name\` text NOT NULL,
  	\`site_tagline\` text,
  	\`site_description\` text,
  	\`logo_id\` integer,
  	\`dark_logo_id\` integer,
  	\`favicon_id\` integer,
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
  	FOREIGN KEY (\`default_social_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_site_settings\`("id", "site_name", "site_tagline", "site_description", "logo_id", "dark_logo_id", "favicon_id", "primary_color", "secondary_color", "accent_color", "default_seo_title", "default_seo_description", "default_social_image_id", "twitter_u_r_l", "youtube_u_r_l", "facebook_u_r_l", "instagram_u_r_l", "discord_u_r_l", "github_u_r_l", "footer_description", "copyright_text", "contact_email", "contact_information", "updated_at", "created_at") SELECT "id", "site_name", "site_tagline", "site_description", "logo_id", "dark_logo_id", "favicon_id", "primary_color", "secondary_color", "accent_color", "default_seo_title", "default_seo_description", "default_social_image_id", "twitter_u_r_l", "youtube_u_r_l", "facebook_u_r_l", "instagram_u_r_l", "discord_u_r_l", "github_u_r_l", "footer_description", "copyright_text", "contact_email", "contact_information", "updated_at", "created_at" FROM \`site_settings\`;`)
  await db.run(sql`DROP TABLE \`site_settings\`;`)
  await db.run(sql`ALTER TABLE \`__new_site_settings\` RENAME TO \`site_settings\`;`)
  await db.run(sql`CREATE INDEX \`site_settings_logo_idx\` ON \`site_settings\` (\`logo_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_dark_logo_idx\` ON \`site_settings\` (\`dark_logo_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_favicon_idx\` ON \`site_settings\` (\`favicon_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_default_social_image_idx\` ON \`site_settings\` (\`default_social_image_id\`);`)
}
