import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-d1-sqlite'
import { audienceTablesV1 } from '../publishing/audience-schema-v1'
import { publishingSharingSchemaV1 } from '../publishing/sharing-schema-v1'
import { publishingReadersSchemaV1 } from '../publishing/readers-schema-v1'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const [, table, versions] of audienceTablesV1) {
    for (const [target, prefix] of [[table, ''], ...(versions ? [[versions, 'version_']] : [])]) {
      const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${target}")`))
      for (const [name, definition] of [
        ['publishing_readership', "text NOT NULL DEFAULT 'site' CHECK(VALUE IN ('site','restricted'))"],
        ['publishing_owner', 'integer REFERENCES users(id)'],
        ['publishing_people', "text NOT NULL DEFAULT '[]' CHECK(json_valid(VALUE) AND json_type(VALUE)='array')"],
        ['publishing_groups', "text NOT NULL DEFAULT '[]' CHECK(json_valid(VALUE) AND json_type(VALUE)='array')"],
        ['publishing_operation_key', 'text'],
        ['publishing_lineage', 'text'],
        ['publishing_published_at', 'text'],
        ['publishing_identity', 'text'],
      ]) {
        const column = prefix + name
        if (!columns.some(item => item.name === column))
          await db.run(sql.raw(`ALTER TABLE "${target}" ADD COLUMN "${column}" ${definition.replaceAll('VALUE', `"${column}"`)}`))
      }
      if (!prefix) await db.run(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}_publishing_operation_idx" ON "${table}"(publishing_operation_key)`))
      if (!prefix) {
        // Backfill only the new metadata without rewriting historical actor or
        // epoch values. D1's atomic batch restores the exact existing guard in
        // the same transaction; a failure cannot leave writes unguarded.
        const name = `${table}_vc_site_update`
        const guards = await db.all<{ name: string; sql: string }>(sql.raw(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='${table}' ORDER BY name`))
        const client = (db as unknown as { $client: D1Database }).$client
        if (!client?.batch || !guards.some(guard => guard.name === name)) throw Error('Atomic guarded metadata migration is unavailable.')
        await client.batch([
          ...guards.map(guard => client.prepare(`DROP TRIGGER "${guard.name.replaceAll('"', '""')}"`)),
          client.prepare(`UPDATE "${target}" SET publishing_identity=lower(hex(randomblob(16))) WHERE publishing_identity IS NULL`),
          ...(versions ? [client.prepare(`UPDATE "${target}" SET publishing_published_at=updated_at WHERE _status='published' AND publishing_published_at IS NULL`)] : []),
          ...guards.map(guard => client.prepare(guard.sql)),
        ])
      } else await db.run(sql.raw(`UPDATE "${target}" SET version_publishing_identity=(SELECT p.publishing_identity FROM "${table}" p WHERE p.id="${target}".parent_id) WHERE version_publishing_identity IS NULL`))
      if (!prefix) await db.run(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}_publishing_identity_idx" ON "${table}"(publishing_identity)`))
      if (versions && prefix) await db.run(sql.raw(`UPDATE "${target}" SET "${prefix}publishing_published_at"="${prefix}updated_at" WHERE "${prefix}_status"='published' AND "${prefix}publishing_published_at" IS NULL`))
    }
  }
  for (const [table, column] of [['pages', 'publishing_archived'], ['_pages_v', 'version_publishing_archived']]) {
    const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`))
    if (!columns.some(item => item.name === column)) await db.run(sql.raw(`ALTER TABLE "${table}" ADD COLUMN "${column}" integer NOT NULL DEFAULT 0 CHECK("${column}" IN(0,1))`))
  }
  const mediaColumns = await db.all<{ name: string }>(sql.raw('PRAGMA table_info(media)'))
  if (!mediaColumns.some(column => column.name === 'prefix')) await db.run(sql.raw('ALTER TABLE media ADD COLUMN prefix text'))
  if (!mediaColumns.some(column => column.name === 'publishing_source_collection')) await db.run(sql.raw("ALTER TABLE media ADD COLUMN publishing_source_collection text CHECK(publishing_source_collection IN('posts','pages'))"))
  if (!mediaColumns.some(column => column.name === 'publishing_source_i_d')) await db.run(sql.raw('ALTER TABLE media ADD COLUMN publishing_source_i_d numeric'))
  if (!mediaColumns.some(column => column.name === 'publishing_original_filename')) await db.run(sql.raw('ALTER TABLE media ADD COLUMN publishing_original_filename text'))
  if (!mediaColumns.some(column => column.name === 'publishing_requires_publication')) await db.run(sql.raw('ALTER TABLE media ADD COLUMN publishing_requires_publication integer NOT NULL DEFAULT 0 CHECK(publishing_requires_publication IN(0,1))'))
  if (!mediaColumns.some(column => column.name === 'publishing_source_identity')) await db.run(sql.raw('ALTER TABLE media ADD COLUMN publishing_source_identity text'))
  for (const table of ['imports', 'exports']) {
    const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`))
    if (!columns.some(column => column.name === 'prefix')) await db.run(sql.raw(`ALTER TABLE "${table}" ADD COLUMN prefix text`))
  }
  for (const statement of publishingSharingSchemaV1) await db.run(sql.raw(statement))
  for (const statement of publishingReadersSchemaV1()) await db.run(sql.raw(statement))
  await db.run(sql.raw(`CREATE TRIGGER IF NOT EXISTS site_tpl_publishing_defaults_delete BEFORE DELETE ON site_tpl
    WHEN EXISTS(SELECT 1 FROM vc_scoped_settings s WHERE s.scope LIKE 'site:%' AND (
      CAST(json_extract(s.value,'$.defaultSiteTemplate') AS INTEGER)=OLD.id OR
      CAST(json_extract(s.value,'$.intranetSiteTemplate') AS INTEGER)=OLD.id))
    BEGIN SELECT RAISE(ABORT,'An assigned Main or Intranet template cannot be deleted'); END`))
  // Keep historical indexes on shared design definitions. Audience-owned slugs are
  // unique only inside one site's publishing area.
  for (const [, table] of audienceTablesV1) {
    const columns = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`))
    if (!columns.some(column => column.name === 'slug')) continue
    const indexes = await db.all<{ name: string; unique: number }>(sql.raw(`PRAGMA index_list("${table}")`))
    for (const index of indexes) {
      if (!index.unique || index.name.startsWith('sqlite_')) continue
      const fields = await db.all<{ name: string }>(sql.raw(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`))
      if (fields.length === 2 && fields[0].name === 'platform_site' && fields[1].name === 'slug')
        await db.run(sql.raw(`DROP INDEX "${index.name.replaceAll('"', '""')}"`))
    }
    await db.run(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}_site_audience_slug_idx" ON "${table}"(platform_site,audience,slug)`))
  }
  for (const operation of ['INSERT', 'UPDATE']) {
    await db.run(sql.raw(`CREATE TRIGGER IF NOT EXISTS pages_publishing_parent_${operation.toLowerCase()}
      BEFORE ${operation} ON pages WHEN NEW.parent_id IS NOT NULL AND (
        NOT EXISTS(SELECT 1 FROM pages p WHERE p.id=NEW.parent_id AND p.platform_site=NEW.platform_site AND p.audience=NEW.audience)
        OR EXISTS(WITH RECURSIVE parents(id,parent_id) AS(
          SELECT id,parent_id FROM pages WHERE id=NEW.parent_id UNION SELECT p.id,p.parent_id FROM pages p JOIN parents a ON p.id=a.parent_id)
          SELECT 1 FROM parents WHERE id=NEW.id))
      BEGIN SELECT RAISE(ABORT,'Page hierarchy must remain inside its site and audience without cycles'); END`))
  }
  await db.run(sql.raw(`CREATE TRIGGER IF NOT EXISTS pages_publishing_parent_delete BEFORE DELETE ON pages
    WHEN OLD.audience='intranet' AND EXISTS(SELECT 1 FROM pages WHERE parent_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Review internal child Pages before deleting their parent'); END`))
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw Error('Unified publishing requires audience-aware recovery; restore a compatible application/database pair.')
}
