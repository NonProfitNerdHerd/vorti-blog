import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactTimeline } from '../../src/crm/timeline'
import { CRMAttachments } from '../../src/crm/attachments'
import { FinanceRepository } from '../../src/crm/finance'
import { ContactRepository } from '../../src/crm/contacts'
import { OrganizationRepository } from '../../src/organizations/repository'
import { VolunteerRepository } from '../../src/crm/volunteers'
import type { CRMRecordLink } from '../../src/crm/record-model'

let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmTimelineFixture()
})
afterEach(() => fixture.close())

async function records() {
  const sql = fixture.sqlite,
    contact = fixture.contact
  sql.exec(
    "INSERT INTO vc_crm_households(id,site_id,name,created_at,updated_at) VALUES('house','default','Fictional household','2026-10-24','2026-10-24')",
  )
  for (const [id, start, end] of [
    ['m1', '2025-01-01', '2025-12-31'],
    ['m2', '2026-01-01', null],
  ])
    sql
      .prepare(
        'INSERT INTO vc_crm_household_members(id,household_id,constituent_id,started_on,ended_on) VALUES(?,?,?,?,?)',
      )
      .run(id, 'house', contact, start, end)
  const finance = new FinanceRepository(fixture.db, 1)
  const fund = String(
    (await finance.createFund({ site: 'default', name: 'Fictional fund', operationKey: key() })).id,
  )
  const gift = String(
    (
      await finance.createGift({
        site: 'default',
        constituent: contact,
        kind: 'cash',
        receivedOn: '2026-10-24',
        amount: { currency: 'USD', minorUnits: '100' },
        exponent: 2,
        allocations: [{ fund, currency: 'USD', minorUnits: '100' }],
        reference: 'Fictional gift',
        operationKey: key(),
      })
    ).id,
  )
  for (const kind of ['pledge', 'recurring'])
    sql
      .prepare(
        "INSERT INTO vc_crm_commitments(id,site_id,constituent_id,kind,name,currency,exponent,amount_minor,starts_on,frequency,created_by,created_at,updated_at) VALUES(?,'default',?,?,?,'USD',2,'100','2026-01-01','monthly',1,'2026-10-24','2026-10-24')",
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
  sql
    .prepare(
      "INSERT INTO vc_crm_volunteer_participation(id,activity_id,constituent_id,state,notes) VALUES('participation','activity',?,'attended','')",
    )
    .run(contact)
  return [
    { type: 'contact', id: contact },
    { type: 'gift', id: gift },
    { type: 'household', id: 'house' },
    { type: 'pledge', id: 'pledge' },
    { type: 'recurring', id: 'recurring' },
    { type: 'membership', id: 'term' },
    { type: 'opportunity', id: 'opportunity' },
    { type: 'volunteer-activity', id: 'activity' },
  ] as CRMRecordLink[]
}
async function file(link: CRMRecordLink, category = 'communications', ready = true) {
  const data = new TextEncoder().encode('x'),
    digest = await crypto.subtle.digest('SHA-256', data)
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  const storage = {
    put: async () => ({ size: 1, checksums: { sha256: digest } }),
  } as unknown as R2Bucket
  const files = new CRMAttachments(fixture.db, storage, 1)
  const id = String(
    (
      await files.stage({
        site: 'default',
        link,
        operationKey: key(),
        values: { filename: `Fictional ${link.type} ${category}.txt`, size: 1, sha256, category },
      })
    ).id,
  )
  if (ready)
    await files.upload({
      site: 'default',
      link,
      id,
      expectedRevision: 1,
      operationKey: key(),
      body: new ReadableStream({
        start(c) {
          c.enqueue(data)
          c.close()
        },
      }),
    })
  return id
}
const list = (actor = 1, site = 'default', contact = fixture.contact) =>
  new ContactTimeline(fixture.db, actor).list({ site, contact, group: 'attachments' })
const revision = () =>
  Number(fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision)
async function reader() {
  const authority = new OrganizationRepository(fixture.db, 1)
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'reader',
    active: true,
    expectedRevision: revision(),
    operationKey: key(),
  })
  return authority
}

it('includes all eight authorized parent types without multiplying household history or unrelated contact events', async () => {
  const links = await records()
  for (const link of links) await file(link)
  const page = await list()
  expect(page.total).toBe(16)
  expect(new Set(page.docs.map((r) => r.id)).size).toBe(16)
  for (const link of links)
    expect(
      page.docs.filter(
        (r) => r.targetType === (link.type === 'contact' ? 'attachment' : link.type),
      ),
    ).toHaveLength(2)
  const unrelated = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional unrelated person' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  expect((await list(1, 'default', unrelated)).total).toBe(0)
  fixture.sqlite
    .prepare("UPDATE vc_crm_household_members SET ended_on='2026-10-24' WHERE id='m2'")
    .run()
  expect((await list()).total).toBe(16)
})

it('intersects file classification, parent grants and pending uploader visibility, and removes private history after revocation', async () => {
  const links = await records()
  for (const link of links) await file(link)
  await file(links[1], 'volunteer-hours')
  await file(links[1], 'communications', false)
  const authority = await reader()
  expect((await list(2)).total).toBe(18)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'volunteer-hours', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const privateCategory = await list(2)
  expect(privateCategory.total).toBe(16)
  expect(privateCategory.docs.filter((r) => r.targetType === 'gift')).toHaveLength(2)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [
      { category: 'finances', operation: 'read' },
      { category: 'memberships', operation: 'read' },
      { category: 'affiliations', operation: 'read' },
      { category: 'restricted-activity', operation: 'read' },
    ],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const restricted = await list(2)
  expect(restricted.total).toBe(2)
  expect(restricted.docs.every((r) => r.targetType === 'attachment')).toBe(true)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'communications', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  expect((await list(2)).total).toBe(0)
})

it('does not reveal chapter files through shared identity or activity files through discoverable skills alone', async () => {
  const links = await records()
  for (const link of links) await file(link)
  fixture.sqlite.exec(
    "INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) SELECT 'other',organization_id,id,'Other chapter','other','2026-10-24','2026-10-24' FROM vc_sites WHERE id='default';INSERT INTO vc_site_ancestry VALUES('other','other',0),('default','other',1)",
  )
  fixture.sqlite
    .prepare(
      "INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,created_at,updated_at) SELECT ?,organization_id,'other',constituent_id,created_at,updated_at FROM vc_crm_affiliations WHERE site_id='default' AND constituent_id=?",
    )
    .run(key(), fixture.contact)
  expect((await list(1, 'other')).total).toBe(0)
  const skillsOnly = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional discoverable volunteer' },
        roles: ['volunteer'],
        operationKey: key(),
      })
    ).id,
  )
  await new VolunteerRepository(fixture.db, 1).saveProfile({
    site: 'default',
    operationKey: key(),
    values: {
      constituent: skillsOnly,
      skills: ['Logistics'],
      interests: [],
      availability: 'Saturday',
      doNotContact: false,
      archived: false,
    },
  })
  expect((await list(1, 'default', skillsOnly)).total).toBe(0)
  fixture.sqlite
    .prepare(
      "UPDATE vc_crm_affiliations SET archived=1 WHERE site_id='default' AND constituent_id=?",
    )
    .run(fixture.contact)
  await expect(list()).rejects.toThrow()
})
