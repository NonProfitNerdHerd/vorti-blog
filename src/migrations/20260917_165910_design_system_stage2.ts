import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

// Frozen seed snapshot: later block-pack releases must not change this migration.
const heroBoardFields = [
  { key: 'eyebrow', label: 'Eyebrow', kind: 'text' },
  { key: 'headline', label: 'Headline', kind: 'text', required: true },
  { key: 'subheadline', label: 'Subheadline', kind: 'textarea' },
  { key: 'backgroundImage', label: 'Background Image', kind: 'media' },
  { key: 'foregroundImage', label: 'Foreground Image', kind: 'media' },
  { key: 'primaryCTA', label: 'Primary CTA', kind: 'group', children: [{ key: 'label', label: 'Label', kind: 'text' }, { key: 'url', label: 'URL', kind: 'url' }] },
  { key: 'secondaryCTA', label: 'Secondary CTA', kind: 'group', children: [{ key: 'label', label: 'Label', kind: 'text' }, { key: 'url', label: 'URL', kind: 'url' }] },
] as const
const heroBoardDesigns = [
  { name: 'Hero Board - Classic', slug: 'hero-board-classic', design: { alignment: 'left', width: 'full', spacing: 'large', imageTreatment: 'background', overlay: 'dark', textContrast: 'light', buttonStyle: 'primary' } },
  { name: 'Hero Board - Centered', slug: 'hero-board-centered', design: { alignment: 'center', width: 'full', spacing: 'large', imageTreatment: 'background', overlay: 'dark', textContrast: 'light', buttonStyle: 'outline' } },
  { name: 'Hero Board - Split', slug: 'hero-board-split', design: { alignment: 'left', width: 'wide', spacing: 'medium', imageTreatment: 'split', overlay: 'none', textContrast: 'light', buttonStyle: 'primary' } },
  { name: 'Hero Board - Feature', slug: 'hero-board-feature', design: { alignment: 'left', width: 'wide', spacing: 'extra-large', imageTreatment: 'feature', overlay: 'dark', textContrast: 'light', buttonStyle: 'minimal' } },
] as const

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Vorti Blog owns role assignment. Check before any schema or seed writes so
  // an existing installation can never lose its sole administrator account.
  const existingUsers = await db.all<{ id: number }>(sql`SELECT \`id\` FROM \`users\`;`)
  const administratorEmail = process.env.DESIGN_ADMIN_EMAIL?.trim().toLowerCase()
  if (existingUsers.length > 0) {
    if (!administratorEmail) throw new Error('Stage 2 migration requires DESIGN_ADMIN_EMAIL for an existing Users table. Run the read-only preflight first.')
    const matchingUsers = await db.all<{ id: number }>(sql`SELECT \`id\` FROM \`users\` WHERE lower(\`email\`) = ${administratorEmail};`)
    if (matchingUsers.length !== 1) throw new Error('Stage 2 migration requires DESIGN_ADMIN_EMAIL to match exactly one existing User. No changes made.')
  }
  await db.run(sql`CREATE TABLE \`design_block_types_fields_children\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`label\` text,
  	\`kind\` text,
  	\`required\` integer,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`design_block_types_fields\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`design_block_types_fields_children_order_idx\` ON \`design_block_types_fields_children\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`design_block_types_fields_children_parent_id_idx\` ON \`design_block_types_fields_children\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_design_block_types_v_version_fields_children\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`label\` text,
  	\`kind\` text,
  	\`required\` integer,
  	\`_uuid\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`_design_block_types_v_version_fields\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_fields_children_order_idx\` ON \`_design_block_types_v_version_fields_children\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`_design_block_types_v_version_fields_children_parent_id_idx\` ON \`_design_block_types_v_version_fields_children\` (\`_parent_id\`);`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`role\` text DEFAULT 'editor';`)
  // Only the explicitly selected existing User is elevated.
  if (administratorEmail) {
    await db.run(sql`UPDATE \`users\` SET \`role\` = 'administrator' WHERE lower(\`email\`) = ${administratorEmail};`)
  }
  await db.run(sql`ALTER TABLE \`design_block_designs\` ADD \`design_width\` text;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` ADD \`design_image_treatment\` text;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` ADD \`design_overlay\` text;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` ADD \`design_text_contrast\` text;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` ADD \`design_button_style\` text;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` ADD \`version_design_width\` text;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` ADD \`version_design_image_treatment\` text;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` ADD \`version_design_overlay\` text;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` ADD \`version_design_text_contrast\` text;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` ADD \`version_design_button_style\` text;`)
  const hero = await payload.create({
    collection: 'design-block-types', overrideAccess: true, req,
    data: {
      name: 'Hero Board', slug: 'hero-board',
      description: 'Reusable hero/banner component for prominent introductory content.',
      rendererKey: 'hero-board', schemaVersion: 1, status: 'published', _status: 'published',
      fields: heroBoardFields as never,
    },
  })
  for (const variant of heroBoardDesigns) {
    await payload.create({
      collection: 'design-block-designs', overrideAccess: true, req,
      data: { name: variant.name, slug: variant.slug, blockType: hero.id, status: 'published', _status: 'published', design: variant.design as never },
    })
  }
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  for (const variant of heroBoardDesigns) {
    await payload.delete({ collection: 'design-block-designs', where: { slug: { equals: variant.slug } }, overrideAccess: true, req })
  }
  await payload.delete({ collection: 'design-block-types', where: { slug: { equals: 'hero-board' } }, overrideAccess: true, req })
  await db.run(sql`DROP TABLE \`design_block_types_fields_children\`;`)
  await db.run(sql`DROP TABLE \`_design_block_types_v_version_fields_children\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`role\`;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` DROP COLUMN \`design_width\`;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` DROP COLUMN \`design_image_treatment\`;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` DROP COLUMN \`design_overlay\`;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` DROP COLUMN \`design_text_contrast\`;`)
  await db.run(sql`ALTER TABLE \`design_block_designs\` DROP COLUMN \`design_button_style\`;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` DROP COLUMN \`version_design_width\`;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` DROP COLUMN \`version_design_image_treatment\`;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` DROP COLUMN \`version_design_overlay\`;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` DROP COLUMN \`version_design_text_contrast\`;`)
  await db.run(sql`ALTER TABLE \`_design_block_designs_v\` DROP COLUMN \`version_design_button_style\`;`)
}
