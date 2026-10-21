import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'
import { cmsCollections } from '../organizations/cms-collections'
import { cmsOwnershipGuardsV1 } from '../organizations/cms-schema-v1'
import { legacyContentCapabilities, organizationSchemaV3 } from '../organizations/schema-v3'
import { directorySchemaV1 } from '../organizations/directory-schema-v1'
// Frozen names emitted by the installed native schema builder, which deduplicates index names.
const slugIndexes = [
  'posts',
  'pages',
  'categories',
  'tags',
  'site_tpl',
  'design_block_types',
  'design_block_designs',
  'design_templates',
]
const versionSlugIndexes = [
  '_posts_v',
  '_pages_v',
  '_site_tpl_v',
  '_design_block_types_v',
  '_design_block_designs_v',
  '_design_templates_v',
]

/** Add ownership metadata without rewriting content, versions, IDs or existing relationships. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const statement of organizationSchemaV3) await db.run(sql.raw(statement))
  for (const statement of legacyContentCapabilities) await db.run(sql.raw(statement))
  for (const statement of directorySchemaV1) await db.run(sql.raw(statement))
  const lockColumns = await db.all<{ name: string }>(
    sql.raw('PRAGMA table_info("payload_locked_documents_rels")'),
  )
  if (!lockColumns.some((column) => column.name === 'vc_user_sites_id'))
    await db.run(
      sql.raw(
        'ALTER TABLE payload_locked_documents_rels ADD COLUMN vc_user_sites_id text REFERENCES vc_user_sites(id) ON DELETE CASCADE',
      ),
    )
  await db.run(
    sql.raw(
      'CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_vc_user_sites_id_idx ON payload_locked_documents_rels(vc_user_sites_id)',
    ),
  )
  for (const [, table, versions] of cmsCollections) {
    for (const [name, prefix] of [[table, ''], ...(versions ? [[versions, 'version_']] : [])]) {
      const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${name}")`))
      if (!columns.length)
        throw new Error(`Expected CMS table ${name} before applying ownership migration.`)
      for (const [field, type] of [
        ['platform_site', 'text'],
        ['platform_write_actor', 'numeric'],
        ['platform_write_epoch', 'numeric'],
      ]) {
        if (!columns.some((column) => column.name === prefix + field))
          await db.run(
            sql.raw(
              `ALTER TABLE "${name}" ADD COLUMN "${prefix}${field}" ${type}${field === 'platform_site' ? " DEFAULT 'default'" : ''};`,
            ),
          )
      }
      await db.run(
        sql.raw(
          `UPDATE "${name}" SET "${prefix}platform_site"='default' WHERE "${prefix}platform_site" IS NULL;`,
        ),
      )
      await db.run(
        sql.raw(
          `CREATE INDEX IF NOT EXISTS "${name}_${prefix ? 'version_' : ''}${prefix}platform_site_idx" ON "${name}" ("${prefix}platform_site");`,
        ),
      )
      const position = versionSlugIndexes.indexOf(name)
      if (position >= 0)
        await db.run(
          sql.raw(
            `CREATE INDEX IF NOT EXISTS "version_platformSite_version_slug${position ? `_${position}` : ''}_idx" ON "${name}" (version_platform_site,version_slug)`,
          ),
        )
    }
    const existing = await db.all<{ name: string; unique: number }>(
      sql.raw(`PRAGMA index_list("${table}")`),
    )
    // Route slugs become unique within a site; no slug or URL in the compatibility site changes.
    const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`))
    if (columns.some((column) => column.name === 'slug')) {
      for (const index of existing.filter(
        (index) => index.unique === 1 && !index.name.startsWith('sqlite_autoindex'),
      )) {
        const fields = await db.all<{ name: string }>(
          sql.raw(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`),
        )
        if (fields.length === 1 && fields[0].name === 'slug')
          await db.run(sql.raw(`DROP INDEX "${index.name.replaceAll('"', '""')}";`))
      }
      await db.run(
        sql.raw(
          `CREATE UNIQUE INDEX IF NOT EXISTS "platformSite_slug${slugIndexes.indexOf(table) ? `_${slugIndexes.indexOf(table)}` : ''}_idx" ON "${table}" (platform_site,slug);`,
        ),
      )
      await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS "${table}_slug_idx" ON "${table}" (slug)`))
    }
  }
  for (const statement of cmsOwnershipGuardsV1) await db.run(sql.raw(statement))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error(
    'Site ownership and historical capabilities are retained. Restore a reviewed recovery point to revert.',
  )
}
