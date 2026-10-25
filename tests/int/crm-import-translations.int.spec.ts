import { expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { FinanceRepository } from '../../src/crm/finance'
import { ImportReviewRepository } from '../../src/crm/import-review'
import { approveImport } from '../../src/crm/import-approval'
import { importApplyJob } from '../../src/crm/import-apply-job'
import { CRMJobs } from '../../src/crm/jobs'
import { ImportMappings } from '../../src/crm/import-mappings'
import { FundraisingRepository } from '../../src/crm/fundraising'

it('reviews translated fund codes, resolves an unknown code explicitly, and applies distinct gifts without changing source identifiers', async () => {
  const fixture = await crmImportFixture(),
    key = () => crypto.randomUUID(),
    id = key(),
    now = new Date().toISOString()
  try {
    const finance = new FinanceRepository(fixture.db, 1),
      annual = String(
        (await finance.createFund({ site: 'default', name: 'Annual fund', operationKey: key() }))
          .id,
      ),
      scholarship = String(
        (
          await finance.createFund({
            site: 'default',
            name: 'Scholarship fund',
            operationKey: key(),
          })
        ).id,
      )
    const fundraising = new FundraisingRepository(fixture.db, 1),
      campaign = String(
        (
          await fundraising.save({
            site: 'default',
            kind: 'campaigns',
            values: { name: 'Annual campaign' },
            operationKey: key(),
          })
        ).id,
      ),
      appeal = String(
        (
          await fundraising.save({
            site: 'default',
            kind: 'appeals',
            values: { name: 'Independent appeal' },
            operationKey: key(),
          })
        ).id,
      )
    fixture.sqlite
      .prepare(
        `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at)
      VALUES(?,'default',1,'Translated funds','gifts','Legacy','gifts.csv','csv',1,?,?,'["ID","Fund"]','staging',?,?)`,
      )
      .run(id, 'a'.repeat(64), key(), now, now)
    for (const [index, values] of [
      ['G001', 'ANNUAL'],
      ['G002', 'SCHOLAR'],
      ['G003', 'UNKNOWN'],
    ].entries())
      fixture.sqlite
        .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,?,?)')
        .run(id, index + 2, JSON.stringify(values))
    fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
    const reviews = new ImportReviewRepository(fixture.db, 1)
    await reviews.mapping({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      mapping: {
        version: 2,
        domain: 'gifts',
        headers: ['ID', 'Fund'],
        columns: [
          { field: 'sourceID', column: 0, clearBlank: false, referenceMode: 'record' },
          {
            field: 'fund',
            column: 1,
            clearBlank: false,
            referenceMode: 'record',
            translations: [
              { source: 'ANNUAL', value: annual },
              { source: 'SCHOLAR', value: scholarship },
            ],
            unmatched: 'error',
          },
          ...Object.entries({
            contact: fixture.contact,
            amount: '900719925474099.31',
            currency: 'USD',
            exponent: '2',
            receivedOn: '2026-10-25',
            campaign,
            appeal,
          }).map(([field, value]) => ({
            field,
            value,
            clearBlank: false,
            referenceMode: 'record',
          })),
        ],
      },
    })
    for (const number of [2, 3, 4])
      await reviews.review({
        site: 'default',
        id,
        number,
        expectedRevision: 2,
        rowRevision: 1,
        decision: 'create',
        operationKey: key(),
      })
    expect(
      (await reviews.snapshot('default', id, 4)).issues.some((issue) => issue.field === 'fund'),
    ).toBe(true)
    await expect(
      approveImport(fixture.db, 1, {
        site: 'default',
        id,
        expectedRevision: 2,
        operationKey: key(),
        allowNewUnidentified: false,
      }),
    ).rejects.toThrow('every pending row')
    await reviews.review({
      site: 'default',
      id,
      number: 4,
      expectedRevision: 2,
      rowRevision: 2,
      decision: 'create',
      overrides: { fund: { value: annual, clear: false, referenceMode: 'record' } },
      operationKey: key(),
    })
    expect((await reviews.snapshot('default', id, 4)).issues).toEqual([])
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(0)
    const approved = await approveImport(fixture.db, 1, {
        site: 'default',
        id,
        expectedRevision: 2,
        operationKey: key(),
        allowNewUnidentified: false,
      }),
      jobs = new CRMJobs(fixture.db)
    for (let step = 0; step < 20; step++)
      if (!(await jobs.tick({ 'import-apply': importApplyJob(fixture.db) }, String(approved.job))))
        break
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(String(approved.job))!
        .status,
    ).toBe('completed')
    const rows = fixture.sqlite
      .prepare(
        'SELECT number,applied_id,data_json FROM vc_crm_import_rows WHERE run_id=? ORDER BY number',
      )
      .all(id)
    expect(new Set(rows.map((row) => row.applied_id)).size).toBe(3)
    for (const [index, row] of rows.entries()) {
      const gift = await finance.get('default', String(row.applied_id))
      expect(gift.originalMinor).toBe('90071992547409931')
      expect(gift.allocations[0].fund).toBe(index === 1 ? scholarship : annual)
      expect((await fundraising.attribution('default', String(row.applied_id))).doc).toMatchObject({
        campaign_id: campaign,
        appeal_id: appeal,
      })
      expect(JSON.parse(String(row.data_json))[0]).toBe(`G00${index + 1}`)
    }
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) AS n FROM vc_crm_source_identifiers WHERE domain='gifts'")
        .get()!.n,
    ).toBe(3)
  } finally {
    fixture.close()
  }
})

it('retains exact versioned translation choices in reusable mappings without domain writes', async () => {
  const fixture = await crmImportFixture()
  try {
    const mappings = new ImportMappings(fixture.db, 1),
      mapping = {
        version: 2,
        domain: 'contacts',
        headers: ['Permission'],
        columns: [
          {
            field: 'emailAllowed',
            column: 0,
            clearBlank: false,
            referenceMode: 'record',
            translations: [
              { source: 'YES', value: 'true' },
              { source: 'NO', value: 'false' },
            ],
            unmatched: 'error',
          },
        ],
      },
      saved = await mappings.save({
        site: 'default',
        domain: 'contacts',
        name: 'Legacy preferences',
        mapping,
        archived: false,
        operationKey: crypto.randomUUID(),
      })
    expect((await mappings.get('default', 'contacts', String(saved.id))).mapping).toEqual(mapping)
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers').get()!.n,
    ).toBe(0)
  } finally {
    fixture.close()
  }
})
