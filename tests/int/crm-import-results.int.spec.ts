import { expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { importResultsCSV } from '../../src/crm/import-results'
import { importCSVCell } from '../../src/crm/import-result-csv'
import { csvImportRows } from '../../src/crm/import-csv'

it('downloads every source row and extra column, isolates owners, filters errors and stops revoked reads', async () => {
  const fixture = await crmImportFixture(),
    id = crypto.randomUUID(),
    now = new Date().toISOString()
  try {
    fixture.sqlite
      .prepare(
        `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at)
      VALUES(?,'default',1,'Results','contacts','Legacy','source.csv','csv',1,?,?,'["Name","Amount"]','staging',?,?)`,
      )
      .run(id, 'a'.repeat(64), crypto.randomUUID(), now, now)
    for (let index = 0; index < 57; index++) {
      const values =
        index === 56
          ? Array.from({ length: 28 }, (_, column) => `last-${column}`)
          : [`Person ${index}`, index === 0 ? '123456789012345.67' : '=SUM(1,2)']
      fixture.sqlite
        .prepare(
          'INSERT INTO vc_crm_import_rows(run_id,number,data_json,parse_issues) VALUES(?,?,?,?)',
        )
        .run(
          id,
          index + 2,
          JSON.stringify(values),
          index === 3 ? JSON.stringify([{ column: 1, message: 'Fictional source issue' }]) : '[]',
        )
    }
    fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
    await expect(importResultsCSV(fixture.db, 2, 'default', id)).rejects.toThrow()
    const response = await importResultsCSV(fixture.db, 1, 'default', id)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Import-Matching-Rows')).toBe('57')
    const rows = []
    for await (const row of csvImportRows(response.body!)) rows.push(row)
    expect(rows).toHaveLength(58)
    expect(rows[1].values[7]).toBe("'123456789012345.67")
    expect(rows[2].values[7]).toBe("'=SUM(1,2)")
    expect(rows.at(-1)!.values.at(-1)).toBe('last-27')
    const errors = await importResultsCSV(fixture.db, 1, 'default', id, true),
      errorRows = []
    for await (const row of csvImportRows(errors.body!)) errorRows.push(row)
    expect(errorRows).toHaveLength(2)
    expect(errorRows[1].values[5]).toContain('Fictional source issue')
    const revoked = await importResultsCSV(fixture.db, 1, 'default', id),
      reader = revoked.body!.getReader()
    await reader.read()
    fixture.sqlite
      .prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1')
      .run()
    await expect(
      (async () => {
        while (!(await reader.read()).done) {
          /* stop on revoked stream */
        }
      })(),
    ).rejects.toThrow()
  } finally {
    fixture.close()
  }
})

it('quotes spreadsheet formulas, control prefixes, exact long numeric text and embedded CSV delimiters', () => {
  for (const value of [
    '=1+1',
    '+SUM(A1)',
    '-1',
    '@lookup',
    '\tformula',
    ' \r=1',
    '000123',
    '123456789012345.67',
    '1e20',
  ])
    expect(importCSVCell(value).startsWith('"\'')).toBe(true)
  expect(importCSVCell('Ada, "Example"\nsecond line')).toBe('"Ada, ""Example""\nsecond line"')
  expect(importCSVCell('12.50')).toBe('"12.50"')
})
