import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { crmOverview } from '../../src/crm/overview'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
import { ContactRepository } from '../../src/crm/contacts'
import { MembershipRepository } from '../../src/crm/memberships'
let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmTimelineFixture()
})
afterEach(() => fixture.close())
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
