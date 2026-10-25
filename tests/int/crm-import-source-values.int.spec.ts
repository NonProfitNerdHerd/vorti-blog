import { expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { importSourceValues } from '../../src/crm/import-source-values'

it('returns complete distinct source values and counts across row/byte-bounded pages without disclosure to another owner', async () => {
  const fixture = await crmImportFixture(),
    id = crypto.randomUUID(),
    now = new Date().toISOString()
  try {
    fixture.sqlite
      .prepare(
        `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at)
      VALUES(?,'default',1,'Source values','contacts','Legacy','values.csv','csv',1,?,?,'["Code"]','staging',?,?)`,
      )
      .run(id, 'a'.repeat(64), crypto.randomUUID(), now, now)
    const values = [
        ...Array.from({ length: 55 }, (_, index) => [`CODE_${index}`, `CODE_${index}`]).flat(),
        '',
        '  ',
        '\u0000'.repeat(32767) + '0',
        '\u0000'.repeat(32767) + '1',
      ],
      expected = new Map<string, number>()
    for (const [index, value] of values.entries()) {
      fixture.sqlite
        .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,?,?)')
        .run(id, index + 2, JSON.stringify([value]))
      expected.set(value, (expected.get(value) || 0) + 1)
    }
    fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
    let after = 0,
      pages = 0
    const seen = new Map<string, number>()
    do {
      const page = await importSourceValues(fixture.db, 1, 'default', id, 0, after)
      expect(page.total).toBe(expected.size)
      expect(page.docs.length).toBeLessThanOrEqual(50)
      for (const doc of page.docs) {
        expect(doc.position).toBeGreaterThan(after)
        seen.set(doc.value, doc.occurrences)
      }
      after = page.next || 0
      pages++
    } while (after)
    expect(pages).toBeGreaterThan(1)
    expect(seen).toEqual(expected)
    await expect(importSourceValues(fixture.db, 2, 'default', id, 0)).rejects.toThrow()
    await expect(importSourceValues(fixture.db, 1, 'default', id, 1)).rejects.toThrow(
      'source column',
    )
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  } finally {
    fixture.close()
  }
})
