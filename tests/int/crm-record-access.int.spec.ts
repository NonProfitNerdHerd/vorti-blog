import { afterEach, beforeEach, expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { volunteerSchemaV1 } from '../../src/crm/volunteer-schema-v1'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
import { CRMRecordAccess } from '../../src/crm/record-access'
import { crmRecordLink, type CRMRecordLink } from '../../src/crm/record-model'

let fixture: ReturnType<typeof localD1>, contact: string, gift: string
beforeEach(async () => {
  fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'administrator'),(2,'editor');",
  )
  for (const sql of [
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...financeSchemaV1,
    ...fundraisingSchemaV1,
    ...householdSchemaV1,
    ...commitmentSchemaV1,
    ...membershipSchemaV1,
    ...opportunitySchemaV1,
    ...volunteerSchemaV1,
  ])
    fixture.sqlite.exec(sql)
  contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional linked donor' },
        roles: ['donor'],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const finance = new FinanceRepository(fixture.db, 1)
  const fund = String(
    (
      await finance.createFund({
        site: 'default',
        name: 'Fictional fund',
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  gift = String(
    (
      await finance.createGift({
        site: 'default',
        constituent: contact,
        amount: { currency: 'USD', minorUnits: '1000' },
        exponent: 2,
        kind: 'cash',
        receivedOn: '2026-10-24',
        allocations: [{ fund, currency: 'USD', minorUnits: '1000' }],
        reference: 'Fictional gift',
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
})
afterEach(() => fixture.close())

it('resolves every typed domain in its owning chapter and rejects misleading types', async () => {
  const sql = fixture.sqlite
  sql.exec(
    "INSERT INTO vc_crm_households(id,site_id,name,created_at,updated_at) VALUES('house','default','Fictional household','2026-10-24','2026-10-24')",
  )
  for (const kind of ['pledge', 'recurring'])
    sql
      .prepare(
        `INSERT INTO vc_crm_commitments(id,site_id,constituent_id,kind,name,currency,exponent,amount_minor,starts_on,frequency,created_by,created_at,updated_at) VALUES(?,'default',?,?,?,'USD',2,'100','2026-01-01','monthly',1,'2026-10-24','2026-10-24')`,
      )
      .run(kind, contact, kind, kind)
  sql.exec(
    "INSERT INTO vc_crm_membership_types(id,site_id,name,eligibility,term_months,dues_minor,currency,exponent) VALUES('type','default','Fictional type','person',12,'0','USD',2)",
  )
  sql
    .prepare(
      "INSERT INTO vc_crm_membership_terms(id,site_id,type_id,person_id,billing_contact_id,type_name,starts_on,ends_on,dues_minor,currency,exponent,created_by,created_at) VALUES('term','default','type',?,?,'Fictional type','2026-01-01','2026-12-31','0','USD',2,1,'2026-10-24')",
    )
    .run(contact, contact)
  sql
    .prepare("INSERT INTO vc_crm_membership_coverage(term_id,constituent_id) VALUES('term',?)")
    .run(contact)
  sql.exec(
    "INSERT INTO vc_crm_opportunity_pipelines(id,site_id,name) VALUES('pipeline','default','Fictional pipeline');INSERT INTO vc_crm_opportunity_stages(id,pipeline_id,name,position,outcome) VALUES('stage','pipeline','Prospect',0,'open')",
  )
  sql
    .prepare(
      "INSERT INTO vc_crm_opportunities(id,site_id,constituent_id,name,pipeline_id,stage_id,currency,exponent,created_by,created_at,updated_at) VALUES('opportunity','default',?,'Fictional proposal','pipeline','stage','USD',2,1,'2026-10-24','2026-10-24')",
    )
    .run(contact)
  sql.exec(
    "INSERT INTO vc_crm_volunteer_activities(id,site_id,name,starts_on,ends_on) VALUES('activity','default','Fictional activity','2026-10-24','2026-10-24')",
  )
  const refs: CRMRecordLink[] = [
    { type: 'contact', id: contact },
    { type: 'gift', id: gift },
    { type: 'household', id: 'house' },
    { type: 'pledge', id: 'pledge' },
    { type: 'recurring', id: 'recurring' },
    { type: 'membership', id: 'term' },
    { type: 'opportunity', id: 'opportunity' },
    { type: 'volunteer-activity', id: 'activity' },
  ]
  const resolver = new CRMRecordAccess(fixture.db, 1)
  for (const ref of refs) {
    const result = await resolver.resolve('default', ref)
    expect(result.record.id).toBe(ref.id)
    expect(result.record.label).toBeTruthy()
    await fixture.db.batch(resolver.guard('default', ref, crypto.randomUUID()))
  }
  await expect(resolver.resolve('default', { type: 'pledge', id: 'recurring' })).rejects.toThrow()
  expect(() => crmRecordLink('__proto__', contact)).toThrow()
  expect(() => crmRecordLink('contact', contact + '\n')).toThrow()
})

it('requires current domain access before exposing labels and rejects another site', async () => {
  const authority = new OrganizationRepository(fixture.db, 1)
  const revision = () =>
    Number(
      fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
    )
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'reader',
    active: true,
    expectedRevision: revision(),
    operationKey: crypto.randomUUID(),
  })
  const reader = new CRMRecordAccess(fixture.db, 2)
  expect((await reader.resolve('default', { type: 'gift', id: gift })).record.label).toBe(
    'Fictional gift',
  )
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [
      { category: 'finances', operation: 'read' },
      { category: 'communications', operation: 'read' },
    ],
    expectedRevision: revision(),
    operationKey: crypto.randomUUID(),
  })
  await expect(reader.resolve('default', { type: 'gift', id: gift })).rejects.toThrow()
  await expect(reader.resolve('default', { type: 'contact', id: contact })).rejects.toThrow()
  fixture.sqlite.exec(
    "INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) SELECT 'other',organization_id,id,'Other chapter','other','2026-10-24','2026-10-24' FROM vc_sites WHERE id='default';INSERT INTO vc_site_ancestry VALUES('other','other',0),('default','other',1)",
  )
  const admin = new CRMRecordAccess(fixture.db, 1)
  await expect(admin.resolve('other', { type: 'contact', id: contact })).rejects.toThrow()
  await expect(admin.resolve('other', { type: 'gift', id: gift })).rejects.toThrow()
})

it('rolls back a linked write if affiliation is revoked before its atomic checkpoint', async () => {
  const resolver = new CRMRecordAccess(fixture.db, 1),
    link = { type: 'gift' as const, id: gift }
  await resolver.resolve('default', link, 'edit')
  fixture.sqlite.exec('CREATE TABLE fictional_links(id TEXT PRIMARY KEY)')
  fixture.sqlite
    .prepare(
      "UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=? AND site_id='default'",
    )
    .run(contact)
  await expect(
    fixture.db.batch([
      fixture.db.prepare("INSERT INTO fictional_links VALUES('not-committed')"),
      ...resolver.guard('default', link, crypto.randomUUID()),
    ]),
  ).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM fictional_links').get()!.n).toBe(0)
  await expect(resolver.resolve('default', link)).rejects.toThrow()
})
