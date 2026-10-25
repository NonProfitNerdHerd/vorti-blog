import { expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { migrateDatabase } from '../../scripts/lib/migrate-database'
import { migrations } from '../../src/migrations'

it('executes the entire real migration chain on an empty database and reloads without replay', async () => {
  const fixture = localD1()
  try {
    const result = await migrateDatabase(fixture.db)
    expect(result.applied).toEqual(migrations.map((migration) => migration.name))
    expect(await migrateDatabase(fixture.db)).toEqual({ applied: [], total: migrations.length })
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) n FROM design_block_designs WHERE slug LIKE 'hero-board-%'")
        .get(),
    ).toEqual({ n: 4 })
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) n FROM site_tpl WHERE slug='default-website-template'")
        .get(),
    ).toEqual({ n: 1 })
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_constituents').get()).toEqual({
      n: 0,
    })
    expect(fixture.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    for (const [name, type] of [
      ['review_tasks_crm_operation_idx', 'index'],
      ['vc_crm_task_contexts', 'view'],
      ['vc_crm_task_created', 'trigger'],
    ]) {
      expect(
        fixture.sqlite.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name),
      ).toEqual({ type })
    }
  } finally {
    fixture.close()
  }
})
