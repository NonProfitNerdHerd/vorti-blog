import { expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { ImportReviewRepository } from '../../src/crm/import-review'
import { startImportBulkReview } from '../../src/crm/import-bulk-review'
import { importReviewJob } from '../../src/crm/import-review-job'
import { CRMJobs } from '../../src/crm/jobs'
import { approveImport } from '../../src/crm/import-approval'

it('prepares all undecided rows without donor writes, preserves staff decisions, and resumes after cancellation', async () => {
  const fixture = await crmImportFixture(),
    key = () => crypto.randomUUID(),
    id = key(),
    now = new Date().toISOString()
  try {
    fixture.sqlite
      .prepare(
        `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at)
      VALUES(?,'default',1,'Bulk review','contacts','Legacy','donors.csv','csv',1,?,?,'["ID","Name"]','staging',?,?)`,
      )
      .run(id, 'a'.repeat(64), key(), now, now)
    for (const [index, values] of [
      ['A', 'Ada'],
      ['B', ''],
      ['C', 'Keep staff skip'],
      ['D', 'Grace'],
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
        version: 1,
        domain: 'contacts',
        headers: ['ID', 'Name'],
        columns: [
          { field: 'sourceID', column: 0, clearBlank: false, referenceMode: 'record' },
          { field: 'firstName', column: 1, clearBlank: false, referenceMode: 'record' },
        ],
      },
    })
    await reviews.review({
      site: 'default',
      id,
      expectedRevision: 2,
      operationKey: key(),
      number: 4,
      rowRevision: 1,
      decision: 'skip',
    })
    const input = {
        site: 'default',
        id,
        expectedRevision: 2,
        operationKey: key(),
        policy: 'create-or-keep',
      },
      started = await startImportBulkReview(fixture.db, 1, input),
      job = String(started.job),
      jobs = new CRMJobs(fixture.db),
      handlers = { 'import-apply': importReviewJob(fixture.db) }
    expect(await startImportBulkReview(fixture.db, 1, input)).toEqual(started)
    await expect(
      startImportBulkReview(fixture.db, 1, { ...input, expectedRevision: 3, operationKey: key() }),
    ).rejects.toThrow()
    expect(await jobs.tick(handlers, job)).toBe(true)
    const first = fixture.sqlite
      .prepare('SELECT revision,review_hash FROM vc_crm_import_rows WHERE run_id=? AND number=2')
      .get(id)!
    expect(first.review_hash).toBeTruthy()
    const fence = Number(
      fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(job)!.fence,
    )
    await jobs.cancel(1, 'default', job, key(), fence)
    expect(await jobs.tick(handlers, job)).toBe(false)
    const cancelledFence = Number(
      fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(job)!.fence,
    )
    await jobs.retry(1, 'default', job, cancelledFence, key())
    for (let step = 0; step < 10; step++) if (!(await jobs.tick(handlers, job))) break
    expect(
      fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(job)!.status,
    ).toBe('completed')
    expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers').get()!.n,
    ).toBe(0)
    expect(
      fixture.sqlite
        .prepare('SELECT revision,review_hash FROM vc_crm_import_rows WHERE run_id=? AND number=2')
        .get(id),
    ).toEqual(first)
    expect((await reviews.snapshot('default', id, 3)).issues.length).toBeGreaterThan(0)
    expect((await reviews.snapshot('default', id, 4)).selection.decision).toBe('skip')
    expect((await reviews.snapshot('default', id, 5)).issues).toEqual([])
    await expect(
      approveImport(fixture.db, 1, {
        site: 'default',
        id,
        expectedRevision: 3,
        operationKey: key(),
        allowNewUnidentified: false,
      }),
    ).rejects.toThrow('every pending row')
  } finally {
    fixture.close()
  }
})
