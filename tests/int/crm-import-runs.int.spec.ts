import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { ImportRuns } from '../../src/crm/import-runs'
import { OrganizationRepository } from '../../src/organizations/repository'
let fixture: Awaited<ReturnType<typeof crmImportFixture>>
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmImportFixture()
})
afterEach(() => fixture.close())
function run(actor = 1, domain = 'contacts', financial = 0) {
  const id = key(),
    now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,headers_json,stage_state,financial,stage_cursor,created_at,updated_at)
    VALUES(?,'default',?,'Fictional import',?,'Fictional legacy CRM','fictional.csv','csv',1,?,?,'["Name"]','staging',?,'PRIVATE_CURSOR',?,?)`,
    )
    .run(id, actor, domain, 'a'.repeat(64), 'PRIVATE_STORAGE_KEY_' + id, financial, now, now)
  return id
}
it('keeps source runs private to their owner and omits private storage and job payload/cursor fields', async () => {
  const id = run(2),
    repository = new ImportRuns(fixture.db, 2)
  expect((await repository.list({ site: 'default', domain: 'contacts' })).docs[0].id).toBe(id)
  expect(
    (await new ImportRuns(fixture.db, 1).list({ site: 'default', domain: 'contacts' })).total,
  ).toBe(0)
  await expect(new ImportRuns(fixture.db, 1).get('default', id)).rejects.toThrow()
  const job = key(),
    now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_jobs(id,site_id,actor_id,kind,payload,cursor,next_attempt_at,created_at,updated_at) VALUES(?,'default',2,'import-apply','{"private":"PRIVATE_JOB_PAYLOAD"}','PRIVATE_JOB_CURSOR',?,?,?)`,
    )
    .run(job, now, now, now)
  fixture.sqlite.prepare('UPDATE vc_crm_import_runs SET job_id=? WHERE id=?').run(job, id)
  const result = await repository.get('default', id)
  expect(result.job?.id).toBe(job)
  const serialized = JSON.stringify(result)
  for (const privateValue of [
    'PRIVATE_STORAGE_KEY',
    'PRIVATE_CURSOR',
    'PRIVATE_JOB_PAYLOAD',
    'PRIVATE_JOB_CURSOR',
  ])
    expect(serialized).not.toContain(privateValue)
})
it('returns every source row across pages with bounded previews and separate complete row detail', async () => {
  const id = run(),
    repository = new ImportRuns(fixture.db, 1),
    huge = 'Fictional source note '.repeat(100)
  for (let number = 2; number < 59; number++)
    fixture.sqlite
      .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,?,?)')
      .run(
        id,
        number,
        JSON.stringify([
          `Source ${number}`,
          huge,
          ...Array.from({ length: 25 }, (_, i) => `Column ${i}`),
        ]),
      )
  fixture.sqlite.prepare("UPDATE vc_crm_import_runs SET stage_state='review' WHERE id=?").run(id)
  fixture.sqlite
    .prepare(
      'UPDATE vc_crm_import_rows SET review_json=?,review_hash=?,target_id=? WHERE run_id=? AND number=2',
    )
    .run(
      JSON.stringify({ label: 'PRIVATE_RESOLVED_DONOR' }),
      'b'.repeat(64),
      'PRIVATE_TARGET_ID',
      id,
    )
  const first = await repository.rows({ site: 'default', id })
  expect(first.total).toBe(57)
  expect(first.docs).toHaveLength(25)
  expect(first.docs[0]).toMatchObject({ columnCount: 27, previewTruncated: true })
  expect(first.docs[0].previewValues).toHaveLength(20)
  expect(first.docs[0].previewValues[1]).toHaveLength(500)
  expect(JSON.stringify(first)).not.toContain('PRIVATE_RESOLVED_DONOR')
  expect(JSON.stringify(first)).not.toContain('PRIVATE_TARGET_ID')
  const second = await repository.rows({ site: 'default', id, after: first.next! }),
    third = await repository.rows({ site: 'default', id, after: second.next! })
  expect(
    new Set([...first.docs, ...second.docs, ...third.docs].map((row) => row.number)).size,
  ).toBe(57)
  const complete = await repository.row('default', id, 2)
  expect(complete.values).toHaveLength(27)
  expect(complete.values[1]).toBe(huge)
})
it('hides financially classified imports after finance revocation without hiding unrelated owner source runs', async () => {
  const authority = new OrganizationRepository(fixture.db, 1)
  const revision = () =>
    Number(
      fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
    )
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'editor',
    active: true,
    expectedRevision: revision(),
    operationKey: key(),
  })
  const plain = run(2, 'memberships'),
    financial = run(2, 'memberships', 1),
    repository = new ImportRuns(fixture.db, 2)
  expect((await repository.list({ site: 'default', domain: 'memberships' })).total).toBe(2)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'finances', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  expect(
    (await repository.list({ site: 'default', domain: 'memberships' })).docs.map((row) => row.id),
  ).toEqual([plain])
  await expect(repository.get('default', financial)).rejects.toThrow()
  await expect(repository.rows({ site: 'default', id: financial })).rejects.toThrow()
  const context = await repository.context('default')
  expect(context.domains.some((domain) => domain.id === 'gifts')).toBe(false)
  expect(context.domains.some((domain) => domain.id === 'contacts')).toBe(true)
})
