import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { ImportReviewRepository } from '../../src/crm/import-review'
import { approveImport, reopenImport } from '../../src/crm/import-approval'
import { CRMJobs } from '../../src/crm/jobs'
import { importApplyJob } from '../../src/crm/import-apply-job'
import { ContactRepository } from '../../src/crm/contacts'
import type { ImportRun, ImportRow } from '../../src/crm/import-types'
let fixture: Awaited<ReturnType<typeof crmImportFixture>>, reviews: ImportReviewRepository
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmImportFixture()
  reviews = new ImportReviewRepository(fixture.db, 1)
})
afterEach(() => fixture.close())
async function staged(
  rows = [
    ['A', 'Fictional first'],
    ['B', 'Fictional second'],
  ],
) {
  const id = key(),
    now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,created_at,updated_at) VALUES(?,'default',1,'Fictional review','contacts','Fictional old CRM','fictional.csv','csv',1,?,?,'["Source","Name"]','staging',?,?)`,
    )
    .run(id, 'a'.repeat(64), key(), now, now)
  rows.forEach((row, i) =>
    fixture.sqlite
      .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,?,?)')
      .run(id, i + 2, JSON.stringify(row)),
  )
  fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
  await mapping(id, 1)
  return id
}
function run(id: string) {
  return fixture.sqlite
    .prepare('SELECT * FROM vc_crm_import_runs WHERE id=?')
    .get(id) as unknown as ImportRun
}
function row(id: string, number = 2) {
  return fixture.sqlite
    .prepare('SELECT * FROM vc_crm_import_rows WHERE run_id=? AND number=?')
    .get(id, number) as unknown as ImportRow
}
function mapping(id: string, revision: number) {
  return reviews.mapping({
    site: 'default',
    id,
    expectedRevision: revision,
    operationKey: key(),
    mapping: {
      version: 1,
      domain: 'contacts',
      headers: ['Source', 'Name'],
      columns: [
        { field: 'sourceID', column: 0, clearBlank: false, referenceMode: 'record' },
        { field: 'firstName', column: 1, clearBlank: false, referenceMode: 'record' },
      ],
    },
  })
}
function review(id: string, number = 2, decision: 'create' | 'keep' | 'skip' = 'create') {
  return reviews.review({
    site: 'default',
    id,
    number,
    decision,
    expectedRevision: run(id).revision,
    rowRevision: row(id, number).revision,
    operationKey: key(),
  })
}
function approve(id: string, allowNewUnidentified = false) {
  return approveImport(fixture.db, 1, {
    site: 'default',
    id,
    expectedRevision: run(id).revision,
    allowNewUnidentified,
    operationKey: key(),
  })
}
async function finish(job: string) {
  const jobs = new CRMJobs(fixture.db)
  for (let i = 0; i < 100; i++)
    if (!(await jobs.tick({ 'import-apply': importApplyJob(fixture.db) }, job))) break
  expect(fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(job)!.status).toBe(
    'completed',
  )
}
it('validates and reviews without domain writes, then applies only approved rows with payload-bound retries', async () => {
  const id = await staged()
  await review(id)
  await expect(approve(id)).rejects.toThrow('every pending row')
  await review(id, 3)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
  expect((await reviews.snapshot('default', id, 2)).after).toBeTruthy()
  const input = {
      site: 'default',
      id,
      expectedRevision: run(id).revision,
      allowNewUnidentified: false,
      operationKey: key(),
    },
    queued = await approveImport(fixture.db, 1, input)
  expect(await approveImport(fixture.db, 1, input)).toEqual(queued)
  await expect(
    reviews.mapping({
      site: 'default',
      id,
      expectedRevision: run(id).revision,
      operationKey: key(),
      mapping: JSON.parse(run(id).mapping_json!),
    }),
  ).rejects.toThrow()
  await finish(String(queued.job))
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(3)
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers').get()!.n,
  ).toBe(2)
  expect((await reviews.snapshot('default', id, 2)).after).toBeTruthy()
  await expect(
    new ImportReviewRepository(fixture.db, 2).snapshot('default', id, 2),
  ).rejects.toThrow()
})
it('rejects duplicate source IDs, invalid rows, stale mapping reviews and unidentified creation until explicitly allowed', async () => {
  const id = await staged([
    ['A', 'Fictional'],
    ['A', 'Fictional duplicate'],
  ])
  await review(id)
  await review(id, 3)
  await expect(approve(id)).rejects.toThrow('distinct source')
  await review(id, 3, 'skip')
  await mapping(id, run(id).revision)
  await expect(approve(id)).rejects.toThrow('current review')
  await review(id)
  await review(id, 3, 'skip')
  await finish(String((await approve(id)).job))
  const blank = await staged([['', '']])
  const invalid = await review(blank)
  expect(invalid.issues).not.toHaveLength(0)
  await expect(approve(blank, true)).rejects.toThrow('current review')
  await reviews.review({
    site: 'default',
    id: blank,
    number: 2,
    decision: 'create',
    expectedRevision: run(blank).revision,
    rowRevision: row(blank).revision,
    operationKey: key(),
    overrides: {
      firstName: { value: 'Fictional explicit', clear: false, referenceMode: 'record' },
    },
  })
  await expect(approve(blank)).rejects.toThrow('explicit approval')
  await finish(String((await approve(blank, true)).job))
})
it('cancels between applications and reopens without rewriting applied rows or duplicating records', async () => {
  const id = await staged()
  await review(id)
  await review(id, 3)
  const queued = await approve(id),
    job = String(queued.job),
    jobs = new CRMJobs(fixture.db),
    handler = importApplyJob(fixture.db)
  for (let i = 0; i < 10 && !row(id).applied_at; i++)
    await jobs.tick({ 'import-apply': handler }, job)
  const applied = row(id),
    state = fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(job)!
  await expect(
    reopenImport(fixture.db, 1, {
      site: 'default',
      id,
      expectedRevision: run(id).revision,
      operationKey: key(),
    }),
  ).rejects.toThrow()
  await jobs.cancel(1, 'default', job, key(), Number(state.fence))
  await reopenImport(fixture.db, 1, {
    site: 'default',
    id,
    expectedRevision: run(id).revision,
    operationKey: key(),
  })
  await expect(review(id)).rejects.toThrow()
  await finish(String((await approve(id)).job))
  expect(row(id)).toEqual(applied)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(3)
})
it('retains authorized historical snapshots after edits but denies cached contact data after affiliation removal', async () => {
  const id = await staged([['A', 'Fictional retained']])
  await review(id)
  await finish(String((await approve(id)).job))
  const contact = row(id).applied_id!
  // Changing the record does not rewrite its immutable import snapshot.
  fixture.sqlite
    .prepare('UPDATE vc_crm_constituents SET revision=revision+1 WHERE id=?')
    .run(contact)
  expect((await reviews.snapshot('default', id, 2)).after).toBeTruthy()
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?')
    .run(contact)
  await expect(reviews.snapshot('default', id, 2)).rejects.toThrow()
  expect((await new ContactRepository(fixture.db, 1).list({ site: 'default' })).docs).toHaveLength(
    1,
  )
})
