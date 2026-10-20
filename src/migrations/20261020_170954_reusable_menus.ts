import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

type LegacyItem = {
  id: string
  _parent_id: string | number
  label: string
  link_type: string
  page_id: number | null
  url: string | null
  enabled: number | null
  new_tab: number | null
}
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(
    sql`CREATE TABLE IF NOT EXISTS menus (id integer PRIMARY KEY NOT NULL, name text NOT NULL, items text DEFAULT '[]' NOT NULL, starter_key text, revision numeric DEFAULT 0, updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL, created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL);`,
  )
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS menus_starter_key_idx ON menus(starter_key);`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS menus_updated_at_idx ON menus(updated_at);`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS menus_created_at_idx ON menus(created_at);`)
  // The database rejects overlapping native updates even if both hooks read the same revision.
  await db.run(
    sql`CREATE TRIGGER IF NOT EXISTS menus_revision_guard BEFORE UPDATE ON menus WHEN NEW.revision IS NULL OR NEW.revision != OLD.revision + 1 BEGIN SELECT RAISE(ABORT, 'Menu changed. Reload before saving.'); END;`,
  )
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(navigation);`)
  if (!columns.some((column) => column.name === 'primary_menu_id'))
    await db.run(
      sql`ALTER TABLE navigation ADD primary_menu_id integer REFERENCES menus(id) ON DELETE SET NULL;`,
    )
  if (!columns.some((column) => column.name === 'footer_menu_id'))
    await db.run(
      sql`ALTER TABLE navigation ADD footer_menu_id integer REFERENCES menus(id) ON DELETE SET NULL;`,
    )
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS navigation_primary_menu_idx ON navigation(primary_menu_id);`,
  )
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS navigation_footer_menu_idx ON navigation(footer_menu_id);`,
  )
  const locked = await db.all<{ name: string }>(
    sql`PRAGMA table_info(payload_locked_documents_rels);`,
  )
  if (!locked.some((column) => column.name === 'menus_id'))
    await db.run(
      sql`ALTER TABLE payload_locked_documents_rels ADD menus_id integer REFERENCES menus(id);`,
    )
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS payload_locked_documents_rels_menus_id_idx ON payload_locked_documents_rels(menus_id);`,
  )
  await db.run(sql`INSERT OR IGNORE INTO navigation(id) VALUES(1);`)
  const globals = await db.all<{
    id: number
    primary_menu_id: number | null
    footer_menu_id: number | null
  }>(sql`SELECT id,primary_menu_id,footer_menu_id FROM navigation ORDER BY id;`)
  for (const global of globals)
    for (const slot of ['primary', 'footer'] as const) {
      const rows = await db.all<LegacyItem>(
        sql.raw(
          `SELECT * FROM navigation_${slot} WHERE _parent_id=${Number(global.id)} ORDER BY _order;`,
        ),
      )
      const children = await db.all<LegacyItem>(
        sql.raw(
          `SELECT child.* FROM navigation_${slot}_children child JOIN navigation_${slot} parent ON child._parent_id=parent.id WHERE parent._parent_id=${Number(global.id)} ORDER BY child._order;`,
        ),
      )
      const items: unknown[] = []
      const convert = (row: LegacyItem, key: string, parent: string | null) => ({
        key,
        parent,
        label: row.label,
        kind: row.link_type === 'internal' ? 'page' : 'custom',
        ...(row.link_type === 'internal' ? { target: row.page_id } : { url: row.url }),
        enabled: row.enabled !== 0,
        newTab: row.new_tab === 1,
      })
      rows.forEach((row, index) => {
        const key = `${slot}-${index}`
        items.push(convert(row, key, null))
        children
          .filter((child) => child._parent_id === row.id)
          .forEach((child, position) => items.push(convert(child, `${key}-${position}`, key)))
      })
      const starter = `legacy-${global.id}-${slot}`
      await db.run(
        sql`INSERT OR IGNORE INTO menus(name,items,starter_key) VALUES(${slot === 'primary' ? 'Primary' : 'Footer'},${JSON.stringify(items)},${starter});`,
      )
      // Preserve an existing assignment when retrying; never repopulate edited menus.
      await db.run(
        sql.raw(
          `UPDATE navigation SET ${slot}_menu_id=COALESCE(${slot}_menu_id,(SELECT id FROM menus WHERE starter_key='${starter}')) WHERE id=${Number(global.id)};`,
        ),
      )
    }
}
export async function down(_args: MigrateDownArgs): Promise<void> {
  throw new Error('Restore the recorded D1 recovery point to preserve menus and their placements.')
}
