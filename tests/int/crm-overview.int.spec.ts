import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { crmOverview } from '../../src/crm/overview'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
import { ContactRepository } from '../../src/crm/contacts'
import { MembershipRepository } from '../../src/crm/memberships'
import { validateTenantSettings } from '../../src/organizations/scoped-settings'
let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmTimelineFixture()
})
afterEach(() => fixture.close())
it('defaults tenant fiscal reporting to January and validates the chosen start', () => {
  expect(validateTenantSettings({ workspaceEmbedOrigins: [] }).fiscalYearStart).toBe('01-01')
  expect(validateTenantSettings({ workspaceEmbedOrigins: [], fiscalYearStart: '07-01' }).fiscalYearStart).toBe('07-01')
  expect(() => validateTenantSettings({ workspaceEmbedOrigins: [], fiscalYearStart: '02-30' })).toThrow()
})
it("keeps a shared constituent's chapter roles and giving separate between chapter summaries", async () => {
  fixture.sqlite
    .prepare("UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id='default'")
    .run()
  const authority = new OrganizationRepository(fixture.db, 1),
    child = String(
      (
        await authority.createSite({
          parent: 'default',
          name: 'Fictional summary chapter',
          expectedRevision: Number(
            fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!
              .revision,
          ),
          operationKey: key(),
        })
      ).site,
    )
  fixture.sqlite
    .prepare(
      `INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,roles,tags,created_at,updated_at) SELECT ?,organization_id,?,constituent_id,'["volunteer"]','[]',created_at,updated_at FROM vc_crm_affiliations WHERE site_id='default' AND constituent_id=?`,
    )
    .run(key(), child, fixture.contact)
  const finance = new FinanceRepository(fixture.db, 1)
  for (const [site, minorUnits] of [
    ['default', '12345'],
    [child, '56789'],
  ]) {
    const fund = String(
      (
        await finance.createFund({
          site,
          name: 'Fictional separate giving fund',
          operationKey: key(),
        })
      ).id,
    )
    await finance.createGift({
      site,
      constituent: fixture.contact,
      amount: { currency: 'USD', minorUnits },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-10-25',
      allocations: [{ fund, currency: 'USD', minorUnits }],
      operationKey: key(),
    })
  }
  const parent = await crmOverview(fixture.db, 1, 'default', '2026-10-25', fixture.contact),
    chapter = await crmOverview(fixture.db, 1, child, '2026-10-25', fixture.contact)
  expect(parent.contacts).toEqual({ total: 1, donors: 1, volunteers: 0, donorVolunteers: 0 })
  expect(chapter.contacts).toEqual({ total: 1, donors: 0, volunteers: 1, donorVolunteers: 0 })
  expect(parent.received!.currencies[0].minorUnits).toBe('12345')
  expect(chapter.received!.currencies[0].minorUnits).toBe('56789')
})
it('scopes a constituent summary to their own gifts and membership follow-ups and denies revoked identities', async () => {
  const other = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional other donor' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id,
  )
  const finance = new FinanceRepository(fixture.db, 1),
    fund = String(
      (
        await finance.createFund({
          site: 'default',
          name: 'Fictional summary fund',
          operationKey: key(),
        })
      ).id,
    )
  for (const [contact, minorUnits] of [
    [fixture.contact, '12345'],
    [other, '99999'],
  ])
    await finance.createGift({
      site: 'default',
      constituent: contact,
      amount: { currency: 'USD', minorUnits },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-10-25',
      allocations: [{ fund, currency: 'USD', minorUnits }],
      operationKey: key(),
    })
  const memberships = new MembershipRepository(fixture.db, 1),
    type = String(
      (
        await memberships.saveType({
          site: 'default',
          values: {
            name: 'Fictional summary membership',
            eligibility: 'person',
            termMonths: 12,
            minorUnits: '0',
            currency: 'USD',
            exponent: 2,
          },
          operationKey: key(),
        })
      ).id,
    )
  for (const person of [fixture.contact, other])
    await memberships.enroll({
      site: 'default',
      values: { type, typeRevision: 1, person, startsOn: '2026-01-01', endsOn: '2026-11-01' },
      operationKey: key(),
    })
  const selected = await crmOverview(fixture.db, 1, 'default', '2026-10-25', fixture.contact),
    all = await crmOverview(fixture.db, 1, 'default', '2026-10-25')
  expect(selected.contacts.total).toBe(1)
  expect(selected.received).toEqual({
    gifts: 1,
    currencies: [{ currency: 'USD', exponent: 2, minorUnits: '12345' }],
  })
  expect(selected.followups.membershipRenewals).toBe(1)
  expect(all.followups.membershipRenewals).toBe(2)
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?')
    .run(fixture.contact)
  await expect(
    crmOverview(fixture.db, 1, 'default', '2026-10-25', fixture.contact),
  ).rejects.toThrow()
  await expect(
    crmOverview(fixture.db, 1, 'default', '2026-10-25', 'foreign-contact'),
  ).rejects.toThrow()
})
it('counts complete records and exact currency-separated received amounts, excludes in-kind and reconciles adjustments', async () => {
  fixture.sqlite
    .prepare(
      'UPDATE vc_crm_affiliations SET roles=\'["donor","volunteer"]\' WHERE constituent_id=?',
    )
    .run(fixture.contact)
  const finance = new FinanceRepository(fixture.db, 1),
    fund = String(
      (
        await finance.createFund({
          site: 'default',
          name: 'Fictional overview fund',
          operationKey: key(),
        })
      ).id,
    )
  const give = async (amount: string, currency = 'USD', kind: 'cash' | 'in-kind' = 'cash') =>
    finance.createGift({
      site: 'default',
      constituent: fixture.contact,
      amount: { currency, minorUnits: amount },
      exponent: currency === 'JPY' ? 0 : 2,
      kind,
      receivedOn: '2026-10-25',
      allocations: [{ fund, currency, minorUnits: amount }],
      operationKey: key(),
    })
  const huge = await give('9007199254740993100000000000001')
  for (let i = 0; i < 1001; i++) await give('7')
  await give('10', 'JPY')
  await give('999', 'USD', 'in-kind')
  const overview = await crmOverview(fixture.db, 1, 'default', '2026-10-25')
  const donations = await finance.list({ site: 'default', withDonors: true, limit: 50 })
  expect(donations.total).toBe(1004)
  expect(donations.docs).toHaveLength(50)
  expect(donations.docs.every((gift) => gift.donorLabel === 'Fictional timeline donor')).toBe(true)
  expect(overview.contacts).toEqual({ total: 1, donors: 1, volunteers: 1, donorVolunteers: 1 })
  expect(overview.received).toEqual({
    gifts: 1003,
    currencies: [
      { currency: 'JPY', exponent: 0, minorUnits: '10' },
      { currency: 'USD', exponent: 2, minorUnits: '9007199254740993100000000007008' },
    ],
  })
  await finance.adjust({
    site: 'default',
    id: String(huge.id),
    expectedRevision: 1,
    action: 'refund',
    deltaMinor: '-1',
    reason: 'Fictional overview refund',
    operationKey: key(),
  })
  expect((await crmOverview(fixture.db, 1, 'default')).received!.currencies[1].minorUnits).toBe(
    '9007199254740993100000000007007',
  )
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?')
    .run(fixture.contact)
  const hidden = await crmOverview(fixture.db, 1, 'default')
  expect(hidden.contacts.total).toBe(0)
  expect(hidden.received).toEqual({ gifts: 0, currencies: [] })
  expect((await finance.list({ site: 'default', withDonors: true })).total).toBe(0)
}, 30000)
it('omits unauthorized financial and follow-up totals and rejects unrelated sites', async () => {
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
    operationKey: key(),
  })
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [
      { category: 'finances', operation: 'read' },
      { category: 'memberships', operation: 'read' },
      { category: 'restricted-activity', operation: 'read' },
    ],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const overview = await crmOverview(fixture.db, 2, 'default')
  expect(overview.contacts.total).toBe(1)
  expect(overview.received).toBeNull()
  expect(overview.followups).toEqual({ opportunities: null, membershipRenewals: null })
  await expect(crmOverview(fixture.db, 2, 'missing-site')).rejects.toThrow()
})

it('reports tenant fiscal campaign giving and distinct donors from received gifts', async () => {
  const tenant = String(fixture.sqlite.prepare("SELECT organization_id FROM vc_sites WHERE id='default'").get()!.organization_id)
  fixture.sqlite.prepare("INSERT INTO vc_scoped_settings(tenant_id,scope,value) VALUES(?,'tenant',?)")
    .run(tenant, JSON.stringify({ workspaceEmbedOrigins: [], fiscalYearStart: '07-01' }))
  fixture.sqlite.prepare('UPDATE vc_crm_constituents SET created_at=? WHERE id=?').run('2026-10-02T12:00:00Z', fixture.contact)
  const finance = new FinanceRepository(fixture.db, 1)
  const fund = String((await finance.createFund({ site: 'default', name: 'Fiscal test fund', operationKey: key() })).id)
  const campaign = key()
  fixture.sqlite.prepare("INSERT INTO vc_crm_campaigns(id,site_id,name,created_at,updated_at) VALUES(?,'default','Fall Campaign',?,?)")
    .run(campaign, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')
  const gift = async (person: string, minorUnits: string, receivedOn: string, campaignID?: string) => {
    const result = await finance.createGift({ site: 'default', constituent: person, amount: { currency: 'USD', minorUnits }, exponent: 2, kind: 'cash', receivedOn, allocations: [{ fund, currency: 'USD', minorUnits }], operationKey: key() })
    if (campaignID) fixture.sqlite.prepare('INSERT INTO vc_crm_gift_attribution(gift_id,campaign_id) VALUES(?,?)').run(String(result.id), campaignID)
    return result
  }
  await gift(fixture.contact, '1000', '2026-06-30', campaign)
  const recurringGift = await gift(fixture.contact, '2000', '2026-07-02', campaign)
  await gift(fixture.contact, '500', '2026-10-03')
  const organization = String((await new ContactRepository(fixture.db, 1).create({ site: 'default', profile: { kind: 'organization', organizationName: 'Fictional partner' }, roles: [], operationKey: key() })).id)
  const organizationGift = await gift(organization, '3000', '2026-10-10', campaign)
  const schedule = key()
  fixture.sqlite.prepare("INSERT INTO vc_crm_commitments(id,site_id,constituent_id,kind,name,currency,exponent,amount_minor,starts_on,frequency,created_by,created_at,updated_at) VALUES(?,'default',?,'recurring','Monthly support','USD',2,'2000','2026-07-01','monthly',1,?,?)")
    .run(schedule, fixture.contact, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')
  fixture.sqlite.prepare("INSERT INTO vc_crm_giving_applications(id,commitment_id,installment_key,gift_id,amount_minor,reason,created_at) VALUES(?,?,'2026-07',?,'2000','Payment','2026-07-02T00:00:00Z')")
    .run(key(), schedule, String(recurringGift.id))
  const report = await crmOverview(fixture.db, 1, 'default', '2026-10-25')
  expect(report.acquisition.newContactsThisMonth).toBe(1)
  expect(report.donorMetrics).toEqual({ total: 2, newThisMonth: 1, newPast12Months: 2, activeRecurring: 1, recurringHistory: 1 })
  expect(report.campaigns?.fiscalStart).toBe('2026-07-01')
  expect(report.campaigns?.currencies[0].rows).toEqual([
    { id: campaign, name: 'Fall Campaign', minorUnits: '5000' },
    { id: null, name: 'Other', minorUnits: '500' },
  ])
  await finance.adjust({ site: 'default', id: String(organizationGift.id), expectedRevision: 1, action: 'refund', deltaMinor: '-3000', reason: 'Full refund', operationKey: key() })
  const refunded = await crmOverview(fixture.db, 1, 'default', '2026-10-25')
  expect(refunded.donorMetrics?.total).toBe(1)
  expect(refunded.donorMetrics?.newThisMonth).toBe(0)
  expect(refunded.campaigns?.currencies[0].rows[0].minorUnits).toBe('2000')
})

it('lists primary contact methods, net lifetime giving and approved volunteer hours', async () => {
  const row = fixture.sqlite.prepare('SELECT profile FROM vc_crm_constituents WHERE id=?').get(fixture.contact)!
  const profile = JSON.parse(String(row.profile))
  profile.methods = [
    { kind: 'email', value: 'primary@example.org', label: 'Work', primary: true },
    { kind: 'phone', value: '+15551234567', label: 'Mobile', primary: true },
  ]
  fixture.sqlite.prepare('UPDATE vc_crm_constituents SET profile=? WHERE id=?').run(JSON.stringify(profile), fixture.contact)
  const finance = new FinanceRepository(fixture.db, 1)
  const fund = String((await finance.createFund({ site: 'default', name: 'Contacts list fund', operationKey: key() })).id)
  const gift = await finance.createGift({ site: 'default', constituent: fixture.contact, amount: { currency: 'USD', minorUnits: '12500' }, exponent: 2, kind: 'cash', receivedOn: '2026-10-20', allocations: [{ fund, currency: 'USD', minorUnits: '12500' }], operationKey: key() })
  await finance.adjust({ site: 'default', id: String(gift.id), expectedRevision: 1, action: 'refund', deltaMinor: '-2500', reason: 'Partial refund', operationKey: key() })
  const activity = key()
  fixture.sqlite.prepare("INSERT INTO vc_crm_volunteer_activities(id,site_id,name,starts_on,ends_on) VALUES(?,'default','Food drive','2026-10-20','2026-10-20')").run(activity)
  fixture.sqlite.prepare("INSERT INTO vc_crm_volunteer_participation(id,activity_id,constituent_id,state) VALUES(?,?,?,'attended')").run(key(), activity, fixture.contact)
  fixture.sqlite.prepare("INSERT INTO vc_crm_volunteer_hours(id,activity_id,constituent_id,occurred_on,minutes,state,created_by,created_at) VALUES(?,?,?,'2026-10-20',90,'approved',1,'2026-10-20T00:00:00Z')").run(key(), activity, fixture.contact)
  fixture.sqlite.prepare("INSERT INTO vc_crm_volunteer_hours(id,activity_id,constituent_id,occurred_on,minutes,state,created_by,created_at) VALUES(?,?,?,'2026-10-20',45,'submitted',1,'2026-10-20T00:00:00Z')").run(key(), activity, fixture.contact)
  const item = (await new ContactRepository(fixture.db, 1).list({ site: 'default', kind: 'person' })).docs[0]
  expect(item.primaryEmail).toBe('primary@example.org')
  expect(item.primaryPhone).toBe('+15551234567')
  expect(item.contributions).toEqual([{ currency: 'USD', exponent: 2, minorUnits: '10000' }])
  expect(item.volunteerMinutes).toBe('90')
  const authority = new OrganizationRepository(fixture.db, 1)
  const revision = () => Number(fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision)
  await authority.setMembership({ site: 'default', user: 2, role: 'reader', active: true, expectedRevision: revision(), operationKey: key() })
  await authority.setRestrictions({ site: 'default', user: 2, denied: [{ category: 'finances', operation: 'read' }, { category: 'volunteer-hours', operation: 'read' }], expectedRevision: revision(), operationKey: key() })
  const restricted = (await new ContactRepository(fixture.db, 2).list({ site: 'default', kind: 'person' })).docs[0]
  expect(restricted.primaryEmail).toBe('primary@example.org')
  expect(restricted.contributions).toBeNull()
  expect(restricted.volunteerMinutes).toBeNull()
})
