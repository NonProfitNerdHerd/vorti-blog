import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { applyImportSchemaV1 } from '../../src/crm/import-schema-v1'
import { CRMJobs } from '../../src/crm/jobs'
import { PreparedCRMMutations } from '../../src/crm/prepared-mutations'
import { ContactRepository } from '../../src/crm/contacts'
let fixture: Awaited<ReturnType<typeof crmImportFixture>>
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmImportFixture()
})
afterEach(() => fixture.close())
async function draft(count = 1) {
  const id = key()
  fixture.sqlite
    .prepare(
      "INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,file_uploaded_at,stage_state,created_at,updated_at) VALUES(?,'default',1,'Fictional import','contacts','Fictional old CRM','fictional.csv','csv',1,?,?,?,'staging',?,?)",
    )
    .run(
      id,
      'a'.repeat(64),
      key(),
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    )
  for (let number = 1; number <= count; number++)
    fixture.sqlite
      .prepare('INSERT INTO vc_crm_import_rows(run_id,number,data_json) VALUES(?,?,?)')
      .run(id, number, '["Fictional"]')
  fixture.sqlite
    .prepare("UPDATE vc_crm_import_runs SET stage_state='review',mapping_json='{}' WHERE id=?")
    .run(id)
  return id
}
const epoch = () =>
  Number(
    fixture.sqlite.prepare('SELECT authority_revision FROM vc_organizations LIMIT 1').get()!
      .authority_revision,
  )
function review(run: string, number = 1, source = '001') {
  fixture.sqlite
    .prepare(
      "UPDATE vc_crm_import_rows SET decision='create',source_id=?,review_json=?,review_hash=?,review_config_revision=1,review_authority_revision=? WHERE run_id=? AND number=?",
    )
    .run(source, '{"issues":[]}', 'b'.repeat(64), epoch(), run, number)
}
async function approve(run: string) {
  const job = await new CRMJobs(fixture.db).enqueue({
    actor: 1,
    site: 'default',
    kind: 'import-apply',
    payload: { run, phase: 'apply', revision: 2 },
    operationKey: key(),
  })
  fixture.sqlite
    .prepare(
      "UPDATE vc_crm_import_runs SET status='approved',revision=2,job_id=?,approved_authority_revision=? WHERE id=?",
    )
    .run(String(job.id), epoch(), run)
}
function source(run: string, record: string) {
  return fixture.db
    .prepare(
      "INSERT INTO vc_crm_source_identifiers(organization_id,site_id,domain,platform,external_id,record_id,fingerprint,created_run_id,last_run_id,created_at,updated_at) SELECT organization_id,'default','contacts','Fictional old CRM','001',?,?,?,?,?,? FROM vc_sites WHERE id='default'",
    )
    .bind(record, 'c'.repeat(64), run, run, new Date().toISOString(), new Date().toISOString())
}
it('is additive and repeatable and prohibits source claims before approval', async () => {
  await applyImportSchemaV1(
    async (sql) => fixture.sqlite.exec(sql),
    async () =>
      fixture.sqlite.prepare('PRAGMA table_info(vc_crm_source_identifiers)').all() as Array<{
        name: string
      }>,
  )
  const run = await draft()
  await expect(source(run, fixture.contact).run()).rejects.toThrow('approved scoped record')
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers').get()!.n,
  ).toBe(0)
  await expect(
    fixture.db.prepare('DELETE FROM vc_crm_import_runs WHERE id=?').bind(run).run(),
  ).rejects.toThrow('retained')
})
it('rejects incomplete, duplicate and stale reviews before an import can be approved', async () => {
  const incomplete = await draft()
  await expect(approve(incomplete)).rejects.toThrow('incomplete')
  const duplicate = await draft(2)
  review(duplicate, 1)
  review(duplicate, 2)
  await expect(approve(duplicate)).rejects.toThrow('duplicated')
  const stale = await draft()
  review(stale)
  fixture.sqlite
    .prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1')
    .run()
  await expect(approve(stale)).rejects.toThrow('stale')
})
it('requires an approved current record, retains applied rows and never retargets a source identifier', async () => {
  const run = await draft()
  review(run)
  await approve(run)
  await expect(
    fixture.db
      .prepare("UPDATE vc_crm_import_rows SET decision='skip' WHERE run_id=?")
      .bind(run)
      .run(),
  ).rejects.toThrow('Reopen')
  const prepared = new PreparedCRMMutations(fixture.db, 1)
  const contact = String(
    (
      await new ContactRepository(fixture.db, 1, prepared.atomic).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional applied source contact' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  await fixture.db.batch([
    ...(await prepared.statements()),
    source(run, contact),
    fixture.db
      .prepare('UPDATE vc_crm_import_rows SET validated_revision=2 WHERE run_id=? AND number=1')
      .bind(run),
    fixture.db
      .prepare(
        "UPDATE vc_crm_import_rows SET applied_id=?,applied_action='created',applied_at=? WHERE run_id=? AND number=1",
      )
      .bind(contact, new Date().toISOString(), run),
  ])
  expect(
    fixture.sqlite.prepare('SELECT record_id FROM vc_crm_source_identifiers').get()!.record_id,
  ).toBe(contact)
  await expect(
    fixture.db
      .prepare('UPDATE vc_crm_source_identifiers SET record_id=?')
      .bind(fixture.contact)
      .run(),
  ).rejects.toThrow('lineage')
  await expect(
    fixture.db
      .prepare('UPDATE vc_crm_import_rows SET validated_revision=3 WHERE run_id=?')
      .bind(run)
      .run(),
  ).rejects.toThrow('retained')
  await expect(fixture.db.prepare('DELETE FROM vc_crm_source_identifiers').run()).rejects.toThrow(
    'retained',
  )
})
it('rolls the domain mutation, source claim and completion back together when validation is stale', async () => {
  const run = await draft()
  review(run)
  await approve(run)
  const prepared = new PreparedCRMMutations(fixture.db, 1)
  const contact = String(
    (
      await new ContactRepository(fixture.db, 1, prepared.atomic).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional never committed import' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  await expect(
    fixture.db.batch([
      ...(await prepared.statements()),
      source(run, contact),
      fixture.db
        .prepare(
          "UPDATE vc_crm_import_rows SET applied_id=?,applied_action='created',applied_at=? WHERE run_id=? AND number=1",
        )
        .bind(contact, new Date().toISOString(), run),
    ]),
  ).rejects.toThrow('current reviewed context')
  expect(
    fixture.sqlite.prepare('SELECT id FROM vc_crm_constituents WHERE id=?').get(contact),
  ).toBeUndefined()
  expect(
    fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers').get()!.n,
  ).toBe(0)
  expect(
    fixture.sqlite.prepare('SELECT applied_at FROM vc_crm_import_rows WHERE run_id=?').get(run)!
      .applied_at,
  ).toBeNull()
})
