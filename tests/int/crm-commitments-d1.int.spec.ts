import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { CommitmentRepository } from '../../src/crm/commitments'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { MembershipRepository } from '../../src/crm/memberships'

let proxy: PlatformProxy<{ D1: D1Database }>, db: D1Database
beforeAll(async () => {
  proxy = await getPlatformProxy<{ D1: D1Database }>({
    configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
    persist: false,
    remoteBindings: false,
  })
  db = proxy.env.D1
  await db
    .prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT)')
    .run()
  await db.prepare("INSERT INTO users VALUES(1,'administrator','Fictional operator')").run()
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
    await db.prepare(sql).run()
})
afterAll(async () => {
  await proxy?.dispose()
})
it('reconciles a pledge payment/refund on actual D1 and retains atomic audit/replay history', async () => {
  const key = () => crypto.randomUUID(),
    repo = new CommitmentRepository(db, 1),
    finance = new FinanceRepository(db, 1)
  const contact = String(
    (
      await new ContactRepository(db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional pledge donor' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id,
  )
  const fund = String(
    (await finance.createFund({ site: 'default', name: 'General', operationKey: key() })).id,
  )
  const pledge = String(
    (
      await repo.create({
        site: 'default',
        operationKey: key(),
        values: {
          kind: 'pledge',
          name: 'Annual promise',
          constituent: contact,
          currency: 'USD',
          exponent: 2,
          minorUnits: '1000',
          startsOn: '2026-01-01',
          frequency: 'annually',
          installments: [{ dueOn: '2026-01-01', minorUnits: '1000' }],
        },
      })
    ).id,
  )
  const gift = String(
    (
      await finance.createGift({
        site: 'default',
        constituent: contact,
        amount: { currency: 'USD', minorUnits: '1000' },
        exponent: 2,
        kind: 'cash',
        receivedOn: '2026-01-01',
        allocations: [{ currency: 'USD', minorUnits: '1000', fund }],
        operationKey: key(),
      })
    ).id,
  )
  const installment = (await repo.get('default', pledge, '2026-12-31')).installments[0].key
  const application = {
    site: 'default',
    id: pledge,
    expectedRevision: 1,
    gift,
    giftRevision: 1,
    installment,
    minorUnits: '1000',
    reason: 'Apply real recorded gift',
    operationKey: key(),
  }
  await repo.apply(application)
  expect(await repo.apply(application)).toEqual({ id: pledge })
  await finance.adjust({
    site: 'default',
    id: gift,
    expectedRevision: 2,
    action: 'refund',
    deltaMinor: '-250',
    reason: 'Partial refund',
    operationKey: key(),
  })
  expect((await repo.get('default', pledge, '2026-12-31')).summary).toMatchObject({
    receivedMinor: '750',
    outstandingMinor: '250',
    overdueMinor: '250',
  })
  const before = await db.prepare('SELECT count(*) n FROM vc_crm_giving_applications').first()
  await expect(
    repo.apply({
      ...application,
      operationKey: key(),
      expectedRevision: 2,
      giftRevision: 3,
      minorUnits: '1',
    }),
  ).rejects.toThrow('cannot exceed')
  expect(await db.prepare('SELECT count(*) n FROM vc_crm_giving_applications').first()).toEqual(
    before,
  )
}, 90000)
it('creates membership and dues together on D1 and rolls both back for an overlapping term', async () => {
  const key = () => crypto.randomUUID(),
    members = new MembershipRepository(db, 1)
  const contact = String(
    (
      await new ContactRepository(db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional member' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  const type = String(
    (
      await members.saveType({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Annual membership',
          eligibility: 'person',
          termMonths: 12,
          currency: 'USD',
          exponent: 2,
          minorUnits: '2500',
        },
      })
    ).id,
  )
  const input = {
    site: 'default',
    operationKey: key(),
    values: { type, typeRevision: 1, person: contact, startsOn: '2026-01-01' },
  }
  const term = await members.enroll(input)
  expect(await members.enroll(input)).toEqual(term)
  const record = await members.get('default', String(term.id), '2026-06-01')
  expect(record.doc.status).toBe('current')
  expect(
    (
      await new CommitmentRepository(db, 1).get(
        'default',
        record.doc.dues_commitment_id!,
        '2026-06-01',
      )
    ).summary.receivedMinor,
  ).toBe('0')
  const count = await db.prepare('SELECT count(*) n FROM vc_crm_commitments').first()
  await expect(members.enroll({ ...input, operationKey: key() })).rejects.toThrow('overlap')
  expect(await db.prepare('SELECT count(*) n FROM vc_crm_commitments').first()).toEqual(count)
}, 90000)
