import { beforeAll, afterAll, it, expect } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { MembershipRepository } from '../../src/crm/memberships'
import { ContactRepository } from '../../src/crm/contacts'
import { HouseholdRepository } from '../../src/crm/households'
import { FinanceRepository } from '../../src/crm/finance'
import { CommitmentRepository } from '../../src/crm/commitments'
import { OrganizationRepository } from '../../src/organizations/repository'
import { membershipEnd } from '../../src/crm/membership-model'
const fixture = localD1(),
  db = fixture.db,
  key = () => crypto.randomUUID()
let memberships: MembershipRepository,
  alex: string,
  pat: string,
  individualType: string,
  householdType: string,
  household: string
beforeAll(async () => {
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT);INSERT INTO users VALUES(1,'administrator','Operator'),(2,'editor','Reader');",
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
  ])
    fixture.sqlite.exec(sql)
  memberships = new MembershipRepository(db, 1)
  const contacts = new ContactRepository(db, 1)
  alex = String(
    (
      await contacts.create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Alex' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  pat = String(
    (
      await contacts.create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Pat' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  individualType = String(
    (
      await memberships.saveType({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Annual individual',
          eligibility: 'person',
          termMonths: 12,
          minorUnits: '1000',
          currency: 'USD',
          exponent: 2,
        },
      })
    ).id,
  )
  householdType = String(
    (
      await memberships.saveType({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Annual household',
          eligibility: 'household',
          termMonths: 12,
          minorUnits: '0',
          currency: 'USD',
          exponent: 2,
        },
      })
    ).id,
  )
  household = String(
    (
      await new HouseholdRepository(db, 1).mutate({
        site: 'default',
        action: 'create-household',
        operationKey: key(),
        values: { name: 'Example family', primaryContact: alex, startedOn: '2025-01-01' },
      })
    ).id,
  )
  await new HouseholdRepository(db, 1).mutate({
    site: 'default',
    action: 'add-member',
    id: household,
    expectedRevision: 1,
    operationKey: key(),
    values: { constituent: pat, startedOn: '2025-01-01' },
  })
})
afterAll(() => fixture.close())
it('enrolls once, creates an unpaid dues expectation atomically, and applies an existing gift without adding revenue', async () => {
  const input = {
    site: 'default',
    operationKey: key(),
    values: { type: individualType, typeRevision: 1, person: alex, startsOn: '2026-01-01' },
  }
  const first = await memberships.enroll(input)
  expect(await memberships.enroll(input)).toEqual(first)
  const detail = await memberships.get('default', String(first.id), '2026-06-01')
  expect(detail.doc).toMatchObject({ ends_on: '2026-12-31', dues_minor: '1000', status: 'current' })
  expect(detail.covered.map((c) => c.id)).toEqual([alex])
  const giving = new CommitmentRepository(db, 1),
    dues = await giving.get('default', detail.doc.dues_commitment_id!, '2026-06-01')
  expect(dues.summary.receivedMinor).toBe('0')
  expect((await db.prepare('SELECT count(*) n FROM vc_crm_gifts').first<{ n: number }>())!.n).toBe(
    0,
  )
  const finance = new FinanceRepository(db, 1),
    fund = String(
      (await finance.createFund({ site: 'default', name: 'Dues', operationKey: key() })).id,
    )
  const gift = String(
    (
      await finance.createGift({
        site: 'default',
        constituent: alex,
        amount: { currency: 'USD', minorUnits: '1000' },
        exponent: 2,
        kind: 'cash',
        receivedOn: '2026-01-01',
        allocations: [{ fund, currency: 'USD', minorUnits: '1000' }],
        operationKey: key(),
      })
    ).id,
  )
  await giving.apply({
    site: 'default',
    id: dues.doc.id,
    expectedRevision: 1,
    operationKey: key(),
    gift,
    giftRevision: 1,
    installment: dues.installments[0].key,
    minorUnits: '1000',
    reason: 'Recorded annual dues',
  })
  expect((await giving.get('default', dues.doc.id, '2026-06-01')).summary.outstandingMinor).toBe(
    '0',
  )
  expect((await db.prepare('SELECT count(*) n FROM vc_crm_gifts').first<{ n: number }>())!.n).toBe(
    1,
  )
  await memberships.saveType({
    site: 'default',
    id: individualType,
    expectedRevision: 1,
    operationKey: key(),
    values: {
      name: 'Annual individual',
      eligibility: 'person',
      termMonths: 12,
      minorUnits: '1500',
      currency: 'USD',
      exponent: 2,
    },
  })
  expect(await memberships.enroll(input)).toEqual(first)
  expect((await memberships.get('default', String(first.id), '2026-06-01')).doc.dues_minor).toBe(
    '1000',
  )
})
it('renews using new type terms while preserving prior dates, coverage and financial history', async () => {
  const old = (await memberships.list('default', '2026-12-20', 'expiring')).docs.find(
    (t) => t.person_id === alex,
  )!
  expect(old).toBeTruthy()
  const next = await memberships.enroll({
    site: 'default',
    operationKey: key(),
    values: {
      type: individualType,
      typeRevision: 2,
      person: alex,
      startsOn: '2027-01-01',
      renewedFrom: old.id,
      previousRevision: old.revision,
    },
  })
  expect((await memberships.get('default', String(next.id), '2027-01-01')).doc).toMatchObject({
    renewed_from: old.id,
    dues_minor: '1500',
    ends_on: '2027-12-31',
    status: 'current',
  })
  expect((await memberships.get('default', old.id, '2027-01-01')).doc.status).toBe('expired')
  const before = await db.prepare('SELECT count(*) n FROM vc_crm_commitments').first()
  await expect(
    memberships.enroll({
      site: 'default',
      operationKey: key(),
      values: { type: individualType, typeRevision: 2, person: alex, startsOn: '2027-01-01' },
    }),
  ).rejects.toThrow('overlap')
  expect(await db.prepare('SELECT count(*) n FROM vc_crm_commitments').first()).toEqual(before)
})
it('freezes household coverage by term and captures changed membership on renewal', async () => {
  const term = await memberships.enroll({
    site: 'default',
    operationKey: key(),
    values: {
      type: householdType,
      typeRevision: 1,
      household,
      householdRevision: 2,
      billingContact: alex,
      startsOn: '2026-01-01',
    },
  })
  const repo = new HouseholdRepository(db, 1),
    detail = await repo.get('default', household)
  await repo.mutate({
    site: 'default',
    action: 'end-member',
    id: household,
    expectedRevision: 2,
    operationKey: key(),
    values: {
      member: detail.members.find((m) => m.constituent_id === pat)!.id,
      endedOn: '2026-06-30',
    },
  })
  expect(
    (await memberships.get('default', String(term.id), '2026-12-31')).covered.map((c) => c.label),
  ).toEqual(['Alex', 'Pat'])
  const next = await memberships.enroll({
    site: 'default',
    operationKey: key(),
    values: {
      type: householdType,
      typeRevision: 1,
      household,
      householdRevision: 3,
      billingContact: alex,
      startsOn: '2027-01-01',
      renewedFrom: term.id,
      previousRevision: 1,
    },
  })
  expect(
    (await memberships.get('default', String(next.id), '2027-01-01')).covered.map((c) => c.label),
  ).toEqual(['Alex'])
  expect(
    (await memberships.list('default', '2026-06-01', 'current', '', pat)).docs.some(
      (t) => t.id === term.id,
    ),
  ).toBe(true)
})
it('dates cancellation without erasing dues, and prevents stale or foreign enrollments', async () => {
  const term = (await memberships.list('default', '2027-06-01', 'current')).docs.find(
    (t) => t.person_id === alex,
  )!
  await memberships.cancel({
    site: 'default',
    id: term.id,
    expectedRevision: term.revision,
    effectiveOn: '2027-07-01',
    reason: 'Requested cancellation',
    operationKey: key(),
  })
  expect((await memberships.get('default', term.id, '2027-06-30')).doc.status).toBe('current')
  expect((await memberships.get('default', term.id, '2027-07-01')).doc.status).toBe('cancelled')
  expect(
    (await new CommitmentRepository(db, 1).get('default', term.dues_commitment_id!, '2027-07-01'))
      .summary.outstandingMinor,
  ).toBe('1500')
  const other = await new OrganizationRepository(db, 1).createOrganization({
    name: 'Other organization',
    siteName: 'Other',
    operationKey: key(),
  })
  await expect(memberships.get(String(other.site), term.id, '2027-07-01')).rejects.toThrow()
  await expect(
    memberships.enroll({
      site: 'default',
      operationKey: key(),
      values: {
        type: householdType,
        typeRevision: 1,
        household,
        householdRevision: 2,
        billingContact: alex,
        startsOn: '2028-01-01',
      },
    }),
  ).rejects.toThrow('changed')
  expect(membershipEnd('2024-02-29', 12)).toBe('2025-02-27')
})
it('keeps membership access separate from gift access and refuses paid enrollment without finance edit', async () => {
  const authority = new OrganizationRepository(db, 1)
  const revision = async () =>
    (await db
      .prepare("SELECT revision FROM vc_sites WHERE id='default'")
      .first<{ revision: number }>())!.revision
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'editor',
    active: true,
    expectedRevision: await revision(),
    operationKey: key(),
  })
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [
      { category: 'finances', operation: 'read' },
      { category: 'finances', operation: 'edit' },
    ],
    expectedRevision: await revision(),
    operationKey: key(),
  })
  const term = (await memberships.list('default', '2026-06-01', 'current')).docs.find(
    (t) => t.person_id === alex,
  )!
  const restricted = new MembershipRepository(db, 2)
  expect((await restricted.get('default', term.id, '2026-06-01')).doc.dues_commitment_id).toBeNull()
  await expect(
    new CommitmentRepository(db, 2).get('default', term.dues_commitment_id!, '2026-06-01'),
  ).rejects.toThrow()
  const count = await db.prepare('SELECT count(*) n FROM vc_crm_membership_terms').first()
  await expect(
    restricted.enroll({
      site: 'default',
      operationKey: key(),
      values: { type: individualType, typeRevision: 2, person: alex, startsOn: '2028-01-01' },
    }),
  ).rejects.toThrow()
  expect(await db.prepare('SELECT count(*) n FROM vc_crm_membership_terms').first()).toEqual(count)
})
