import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { PreparedCRMMutations } from '../../src/crm/prepared-mutations'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { MembershipRepository } from '../../src/crm/memberships'
import { HouseholdRepository } from '../../src/crm/households'
import { OrganizationRepository } from '../../src/organizations/repository'
import { CRMJobs, type CRMJobHandler } from '../../src/crm/jobs'

let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmTimelineFixture()
})
afterEach(() => fixture.close())
const count = (table: string) =>
  Number(fixture.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n)

it('prepares a real contact mutation without writing its record, audit or retry receipt', async () => {
  const prepared = new PreparedCRMMutations(fixture.db, 1),
    before = count('vc_platform_audit')
  const result = await new ContactRepository(fixture.db, 1, prepared.atomic).create({
    site: 'default',
    profile: { kind: 'person', firstName: 'Fictional reviewed import' },
    roles: ['donor'],
    operationKey: key(),
  })
  expect(prepared.count).toBe(1)
  expect(
    fixture.sqlite.prepare('SELECT id FROM vc_crm_constituents WHERE id=?').get(String(result.id)),
  ).toBeUndefined()
  expect(count('vc_platform_audit')).toBe(before)
  await fixture.db.batch(await prepared.statements())
  expect(
    fixture.sqlite
      .prepare('SELECT label FROM vc_crm_constituents WHERE id=?')
      .get(String(result.id))!.label,
  ).toBe('Fictional reviewed import')
  expect(count('vc_platform_audit')).toBe(before + 1)
  await expect(fixture.db.batch(await prepared.statements())).rejects.toThrow()
  expect(count('vc_platform_audit')).toBe(before + 1)
})
it('rolls every prepared domain change back when the job is cancelled during preparation', async () => {
  const jobs = new CRMJobs(fixture.db),
    queued = await jobs.enqueue({
      site: 'default',
      actor: 1,
      kind: 'import-apply',
      payload: { test: 'fictional approved row' },
      operationKey: key(),
    })
  const initial = count('vc_crm_constituents')
  const handler: CRMJobHandler = {
    async prepare(job) {
      const prepared = new PreparedCRMMutations(fixture.db, 1)
      await new ContactRepository(fixture.db, 1, prepared.atomic).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional cancelled import' },
        roles: ['contact'],
        operationKey: key(),
      })
      await jobs.cancel(1, 'default', String(queued.id), key(), job.fence)
      return { writes: await prepared.statements(), cursor: 'applied', processed: 1, done: true }
    },
  }
  expect(await jobs.tick({ 'import-apply': handler }, String(queued.id))).toBe(true)
  expect(count('vc_crm_constituents')).toBe(initial)
  expect(
    fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(String(queued.id))!
      .status,
  ).toBe('cancelled')
  expect(
    fixture.sqlite
      .prepare(
        "SELECT count(*) AS n FROM vc_platform_audit WHERE action='contact.created' AND after_value LIKE '%cancelled import%'",
      )
      .get()!.n,
  ).toBe(0)
})
it('retains stale revision and changed-authority guards inside the prepared checkpoint', async () => {
  const contacts = new ContactRepository(fixture.db, 1),
    current = await contacts.get('default', fixture.contact)
  const prepared = new PreparedCRMMutations(fixture.db, 1)
  const request = {
    site: 'default',
    id: fixture.contact,
    expectedRevision: current.revision,
    confirmedSharedUpdate: true,
    profile: { ...current.profile, firstName: 'Fictional stale reviewed value' },
    operationKey: key(),
  }
  await new ContactRepository(fixture.db, 1, prepared.atomic).updateProfile(request)
  await contacts.updateProfile({
    ...request,
    profile: { ...current.profile, firstName: 'Fictional current value' },
    operationKey: key(),
  })
  await expect(fixture.db.batch(await prepared.statements())).rejects.toThrow()
  expect((await contacts.get('default', fixture.contact)).profile.firstName).toBe(
    'Fictional current value',
  )
  const authority = new OrganizationRepository(fixture.db, 1),
    revision = () =>
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
  const fund = String(
    (
      await new FinanceRepository(fixture.db, 1).createFund({
        site: 'default',
        name: 'Fictional prepared fund',
        operationKey: key(),
      })
    ).id,
  )
  const financial = new PreparedCRMMutations(fixture.db, 2)
  await new FinanceRepository(fixture.db, 2, financial.commit).createGift({
    site: 'default',
    constituent: fixture.contact,
    kind: 'cash',
    receivedOn: '2026-10-24',
    amount: { currency: 'USD', minorUnits: '100' },
    exponent: 2,
    allocations: [{ fund, currency: 'USD', minorUnits: '100' }],
    reference: 'Fictional revoked import',
    operationKey: key(),
  })
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'finances', operation: 'edit' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  await expect(fixture.db.batch(await financial.statements())).rejects.toThrow()
  expect(count('vc_crm_gifts')).toBe(0)
})
it('prepares and commits all covered members and dues atomically within the durable statement budget', async () => {
  const household = String(
    (
      await new HouseholdRepository(fixture.db, 1).mutate({
        site: 'default',
        action: 'create-household',
        values: { name: 'Fictional large reviewed household', address: '' },
        operationKey: key(),
      })
    ).id,
  )
  for (let index = 0; index < 60; index++) {
    const contact = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: { kind: 'person', firstName: `Fictional covered member ${index}` },
          roles: ['member'],
          operationKey: key(),
        })
      ).id,
    )
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_household_members(id,household_id,constituent_id,started_on) VALUES(?,?,?,?)',
      )
      .run(key(), household, contact, '2026-01-01')
  }
  const billing = String(
    fixture.sqlite
      .prepare('SELECT constituent_id FROM vc_crm_household_members WHERE household_id=? LIMIT 1')
      .get(household)!.constituent_id,
  )
  const type = String(
    (
      await new MembershipRepository(fixture.db, 1).saveType({
        site: 'default',
        values: {
          name: 'Fictional paid household type',
          eligibility: 'household',
          termMonths: 12,
          minorUnits: '1000',
          currency: 'USD',
          exponent: 2,
        },
        operationKey: key(),
      })
    ).id,
  )
  const prepared = new PreparedCRMMutations(fixture.db, 1)
  const term = await new MembershipRepository(fixture.db, 1, prepared.commit).enroll({
    site: 'default',
    values: {
      type,
      typeRevision: 1,
      household,
      householdRevision: 1,
      billingContact: billing,
      startsOn: '2026-01-01',
    },
    operationKey: key(),
  })
  const writes = await prepared.statements()
  expect(writes.length).toBeLessThan(30)
  expect(count('vc_crm_membership_terms')).toBe(0)
  expect(count('vc_crm_commitments')).toBe(0)
  await fixture.db.batch(writes)
  expect(
    fixture.sqlite
      .prepare('SELECT count(*) AS n FROM vc_crm_membership_coverage WHERE term_id=?')
      .get(String(term.id))!.n,
  ).toBe(60)
  expect(count('vc_crm_commitments')).toBe(1)
  expect(count('vc_crm_pledge_installments')).toBe(1)
  expect(count('vc_crm_gifts')).toBe(0)
})
