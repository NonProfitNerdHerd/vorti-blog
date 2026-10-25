import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import {
  reviewedCRMImport,
  finishReviewedImport,
  type ImportFixture,
} from '../helpers/reviewed-crm-import'
import { prepareImportDomain, type ImportPlanInput } from '../../src/crm/import-domain-plan'
import { HouseholdRepository } from '../../src/crm/households'
import { MembershipRepository } from '../../src/crm/memberships'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
import { importApplyJob } from '../../src/crm/import-apply-job'
import type { ImportDomain, MappedImportCell } from '../../src/crm/import-model'
let fixture: ImportFixture
const key = () => crypto.randomUUID()
const cells = (
  values: Record<string, string>,
  sources: string[] = [],
): Record<string, MappedImportCell> =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      { value, clear: !value.trim(), referenceMode: sources.includes(name) ? 'source' : 'record' },
    ]),
  )
const request = (
  domain: ImportDomain,
  values: Record<string, string>,
  sources: string[] = [],
): Omit<ImportPlanInput, 'operationKey'> => ({
  site: 'default',
  domain,
  sourceSystem: 'Fictional old CRM',
  decision: 'create',
  values: cells(values, sources),
})
async function apply(input: Omit<ImportPlanInput, 'operationKey'>) {
  const queued = await reviewedCRMImport(fixture, [input])
  return (await finishReviewedImport(fixture, queued))[0].applied_id!
}
async function person(sourceID: string, firstName = 'Fictional imported person') {
  return apply(
    request('contacts', {
      sourceID,
      firstName,
      email: 'fictional@example.test',
      emailAllowed: 'false',
      phone: '555-0100',
    }),
  )
}
beforeEach(async () => {
  fixture = await crmImportFixture()
})
afterEach(() => fixture.close())

it('imports contacts, household history and reciprocal relationships through approved jobs with retained source keys', async () => {
  const first = await person('P001'),
    second = await person('P002', 'Fictional second imported person')
  const household = await apply(
    request(
      'households',
      {
        sourceID: 'HH001',
        name: 'Fictional imported household',
        primaryContact: 'P001',
        startedOn: '2026-01-01',
      },
      ['primaryContact'],
    ),
  )
  const member = await apply(
    request(
      'household-members',
      {
        sourceID: 'HM002',
        household: 'HH001',
        contact: 'P002',
        startedOn: '2026-01-02',
        role: 'Member',
      },
      ['household', 'contact'],
    ),
  )
  expect(
    fixture.sqlite
      .prepare('SELECT constituent_id FROM vc_crm_household_members WHERE id=?')
      .get(member)!.constituent_id,
  ).toBe(second)
  expect(
    fixture.sqlite
      .prepare('SELECT record_id FROM vc_crm_source_identifiers WHERE domain=? AND external_id=?')
      .get('household-members', 'HM002')!.record_id,
  ).toBe(member)
  const type = String(
    (
      await new HouseholdRepository(fixture.db, 1).mutate({
        site: 'default',
        action: 'create-type',
        values: { label: 'Employer', reciprocalLabel: 'Employee' },
        operationKey: key(),
      })
    ).id,
  )
  const relationship = await apply(
    request(
      'relationships',
      {
        sourceID: 'R001',
        source: 'P001',
        target: 'P002',
        type,
        startedOn: '2026-01-01',
        notes: 'Fictional retained relationship',
      },
      ['source', 'target'],
    ),
  )
  expect(
    fixture.sqlite
      .prepare('SELECT source_id,target_id FROM vc_crm_relationships WHERE id=?')
      .get(relationship),
  ).toMatchObject({ source_id: first, target_id: second })
  await apply({
    ...request(
      'household-members',
      { sourceID: 'HM002', household: 'HH001', contact: 'P002', endedOn: '2026-10-24' },
      ['household', 'contact'],
    ),
    decision: 'update',
  })
  const history = await new HouseholdRepository(fixture.db, 1).get('default', household)
  expect(history.members.find((row) => row.id === member)!.ended_on).toBe('2026-10-24')
  await apply({
    ...request('contacts', { sourceID: 'P001', firstName: 'Fictional updated name', phone: '' }),
    decision: 'update',
  })
  const contact = fixture.sqlite
    .prepare('SELECT profile FROM vc_crm_constituents WHERE id=?')
    .get(first)!
  const profile = JSON.parse(String(contact.profile))
  expect(profile.methods.some((method: { kind: string }) => method.kind === 'phone')).toBe(false)
  expect(profile.methods.find((method: { kind: string }) => method.kind === 'email').value).toBe(
    'fictional@example.test',
  )
  expect(profile.communication.emailAllowed).toBe(false)
  expect(
    fixture.sqlite
      .prepare('SELECT count(*) AS n FROM vc_crm_constituents WHERE id IN(?,?)')
      .get(first, second)!.n,
  ).toBe(2)
})

it('imports distinct identical gifts exactly, retains split allocations and keeps repeated source gifts without duplication', async () => {
  const donor = await person('P001'),
    finance = new FinanceRepository(fixture.db, 1)
  const funds = []
  for (let index = 0; index < 2; index++)
    funds.push(
      String(
        (
          await finance.createFund({
            site: 'default',
            name: `Fictional import fund ${index}`,
            operationKey: key(),
          })
        ).id,
      ),
    )
  const values = {
    contact: 'P001',
    receivedOn: '2026-10-24',
    amount: '900719925474099.31',
    currency: 'USD',
    exponent: '2',
    allocations: JSON.stringify([
      { fund: funds[0], amount: '1.00' },
      { fund: funds[1], amount: '900719925474098.31' },
    ]),
  }
  const first = request('gifts', { ...values, sourceID: 'G001' }, ['contact']),
    second = request('gifts', { ...values, sourceID: 'G002' }, ['contact'])
  const queued = await reviewedCRMImport(fixture, [first, second])
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(0)
  const rows = await finishReviewedImport(fixture, queued)
  expect(rows).toHaveLength(2)
  expect(rows[0].applied_id).not.toBe(rows[1].applied_id)
  const gift = await finance.get('default', rows[0].applied_id!)
  expect(gift.constituent).toBe(donor)
  expect(gift.originalMinor).toBe('90071992547409931')
  expect(gift.allocations.map((value) => value.minorUnits)).toEqual(['100', '90071992547409831'])
  await apply({ ...first, decision: 'keep' })
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(2)
  await expect(
    prepareImportDomain(fixture.db, 1, { ...first, operationKey: key() }),
  ).rejects.toThrow('existing source identifier')
})

it('imports paid household membership history and explicit cancellation without inventing received dues', async () => {
  const donor = await person('P001')
  const house = await apply(
    request(
      'households',
      {
        sourceID: 'HH001',
        name: 'Fictional membership household',
        primaryContact: 'P001',
        startedOn: '2026-01-01',
      },
      ['primaryContact'],
    ),
  )
  const type = String(
    (
      await new MembershipRepository(fixture.db, 1).saveType({
        site: 'default',
        values: {
          name: 'Fictional imported membership',
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
  const input = request(
    'memberships',
    {
      sourceID: 'M001',
      type,
      household: 'HH001',
      billingContact: 'P001',
      startsOn: '2026-01-01',
      cancelledOn: '2026-06-01',
      cancellationReason: 'Fictional historical cancellation',
    },
    ['household', 'billingContact'],
  )
  const term = await apply(input)
  const saved = await new MembershipRepository(fixture.db, 1).get('default', term, '2026-10-24')
  expect(saved.doc.household_id).toBe(house)
  expect(saved.doc.status).toBe('cancelled')
  expect(saved.covered.map((value) => value.id)).toEqual([donor])
  expect(saved.doc.dues_commitment_id).toBeTruthy()
  expect(
    fixture.sqlite
      .prepare('SELECT amount_minor FROM vc_crm_commitments WHERE id=?')
      .get(saved.doc.dues_commitment_id!)!.amount_minor,
  ).toBe('1000')
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(0)
})

it('imports volunteer preferences, activities, participation and reviewed hours while retaining do-not-contact', async () => {
  const donor = await person('P001')
  const profile = await apply(
    request(
      'volunteer-profiles',
      {
        sourceID: 'VP001',
        contact: 'P001',
        skills: '["Logistics","logistics","Team"]',
        availability: 'Saturday',
        doNotContact: 'true',
      },
      ['contact'],
    ),
  )
  expect(profile).toBe(donor)
  const activity = await apply(
    request('volunteer-activities', {
      sourceID: 'VA001',
      name: 'Fictional imported volunteer event',
      startsOn: '2026-10-24',
      endsOn: '2026-10-24',
      skills: 'Logistics;Team',
    }),
  )
  const participation = await apply(
    request(
      'volunteer-participation',
      { sourceID: 'PART001', activity: 'VA001', contact: 'P001', state: 'attended' },
      ['activity', 'contact'],
    ),
  )
  const hours = await apply(
    request(
      'volunteer-hours',
      {
        sourceID: 'H001',
        activity: 'VA001',
        contact: 'P001',
        occurredOn: '2026-10-24',
        minutes: '90',
        state: 'approved',
        reason: 'Fictional staff verification',
      },
      ['activity', 'contact'],
    ),
  )
  expect(
    fixture.sqlite
      .prepare('SELECT activity_id,state FROM vc_crm_volunteer_participation WHERE id=?')
      .get(participation),
  ).toMatchObject({ activity_id: activity, state: 'attended' })
  expect(
    fixture.sqlite
      .prepare('SELECT state,minutes,revision FROM vc_crm_volunteer_hours WHERE id=?')
      .get(hours),
  ).toMatchObject({ state: 'approved', minutes: 90, revision: 2 })
  await apply({
    ...request('volunteer-profiles', { sourceID: 'VP001', availability: 'Weekends' }),
    decision: 'update',
  })
  const saved = fixture.sqlite
    .prepare(
      'SELECT skills,do_not_contact,availability FROM vc_crm_volunteer_profiles WHERE site_id=? AND constituent_id=?',
    )
    .get('default', donor)!
  expect(JSON.parse(String(saved.skills))).toEqual(['logistics', 'Team'])
  expect(saved.do_not_contact).toBe(1)
  expect(saved.availability).toBe('Weekends')
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_email_outbox').get()!.n).toBe(0)
})

it('rejects a late changed review before applying an earlier valid gift and validates currency/date conflicts before approval', async () => {
  const donor = await person('P001'),
    finance = new FinanceRepository(fixture.db, 1),
    funds = []
  for (let index = 0; index < 2; index++)
    funds.push(
      String(
        (
          await finance.createFund({
            site: 'default',
            name: `Fictional stale fund ${index}`,
            operationKey: key(),
          })
        ).id,
      ),
    )
  const inputs = funds.map((fund, index) =>
    request('gifts', {
      sourceID: `G00${index}`,
      contact: donor,
      fund,
      currency: 'USD',
      exponent: '2',
      amount: '10.00',
      receivedOn: '2026-10-24',
    }),
  )
  const queued = await reviewedCRMImport(fixture, inputs),
    handler = importApplyJob(fixture.db)
  await queued.jobs.tick({ 'import-apply': handler }, queued.job)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(0)
  fixture.sqlite
    .prepare('UPDATE vc_crm_funds SET name=?,revision=revision+1 WHERE id=?')
    .run('Fictional changed classification', funds[1])
  await queued.jobs.tick({ 'import-apply': handler }, queued.job)
  expect(
    fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(queued.job)!.status,
  ).toBe('failed')
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(0)
  expect(
    fixture.sqlite
      .prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers WHERE domain=?')
      .get('gifts')!.n,
  ).toBe(0)
  const type = String(
    (
      await new MembershipRepository(fixture.db, 1).saveType({
        site: 'default',
        values: {
          name: 'Fictional overlap type',
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
  await apply(
    request('memberships', { sourceID: 'M001', type, contact: donor, startsOn: '2026-01-01' }),
  )
  await expect(
    prepareImportDomain(fixture.db, 1, {
      ...request('memberships', { sourceID: 'M002', type, contact: donor, startsOn: '2026-02-01' }),
      operationKey: key(),
    }),
  ).rejects.toThrow('non-overlapping')
})

it('rolls back a cancelled issuance step and resumes approved pending rows without duplicate gifts or source claims', async () => {
  const donor = await person('P001'),
    fund = String(
      (
        await new FinanceRepository(fixture.db, 1).createFund({
          site: 'default',
          name: 'Fictional interrupted fund',
          operationKey: key(),
        })
      ).id,
    )
  const queued = await reviewedCRMImport(fixture, [
    request('gifts', {
      sourceID: 'G001',
      contact: donor,
      fund,
      currency: 'USD',
      exponent: '2',
      amount: '10.00',
      receivedOn: '2026-10-24',
    }),
  ])
  const handler = importApplyJob(fixture.db)
  let cancelled = false
  for (let index = 0; index < 10; index++) {
    const worked = await queued.jobs.tick(
      {
        'import-apply': {
          async prepare(job) {
            const step = await handler.prepare(job)
            if (job.cursor && JSON.parse(job.cursor).phase === 'apply' && !cancelled) {
              cancelled = true
              await queued.jobs.cancel(1, 'default', job.id, key(), job.fence)
            }
            return step
          },
        },
      },
      queued.job,
    )
    if (!worked || cancelled) break
  }
  expect(cancelled).toBe(true)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(0)
  expect(
    fixture.sqlite
      .prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers WHERE domain=?')
      .get('gifts')!.n,
  ).toBe(0)
  const fence = Number(
    fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(queued.job)!.fence,
  )
  await queued.jobs.retry(1, 'default', queued.job, fence, key(), true)
  await finishReviewedImport(fixture, queued)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(1)
  expect(
    fixture.sqlite
      .prepare('SELECT count(*) AS n FROM vc_crm_source_identifiers WHERE domain=?')
      .get('gifts')!.n,
  ).toBe(1)
})

it('allows finance staff with identity read only, then rejects approvals after permission revocation and restoration', async () => {
  const donor = await person('P001'),
    fund = String(
      (
        await new FinanceRepository(fixture.db, 1).createFund({
          site: 'default',
          name: 'Fictional finance-only fund',
          operationKey: key(),
        })
      ).id,
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
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'identity', operation: 'edit' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const input = request('gifts', {
    sourceID: 'G001',
    contact: donor,
    fund,
    currency: 'USD',
    exponent: '2',
    amount: '10.00',
    receivedOn: '2026-10-24',
  })
  const first = await reviewedCRMImport(fixture, [input], { actor: 2 })
  await finishReviewedImport(fixture, first)
  expect(fixture.sqlite.prepare('SELECT created_by FROM vc_crm_gifts').get()!.created_by).toBe(2)
  await expect(
    reviewedCRMImport(
      fixture,
      [request('contacts', { sourceID: 'Denied', firstName: 'Fictional denied identity edit' })],
      { actor: 2 },
    ),
  ).rejects.toThrow()
  const pending = await reviewedCRMImport(
    fixture,
    [
      request('gifts', {
        ...Object.fromEntries(
          Object.entries(input.values).map(([name, cell]) => [name, cell.value]),
        ),
        sourceID: 'G002',
      }),
    ],
    { actor: 2 },
  )
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [
      { category: 'identity', operation: 'edit' },
      { category: 'finances', operation: 'read' },
    ],
    expectedRevision: revision(),
    operationKey: key(),
  })
  await pending.jobs.tick({ 'import-apply': importApplyJob(fixture.db) }, pending.job)
  expect(
    fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(pending.job)!.status,
  ).toBe('failed')
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'identity', operation: 'edit' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  const fence = Number(
    fixture.sqlite.prepare('SELECT fence FROM vc_crm_jobs WHERE id=?').get(pending.job)!.fence,
  )
  await pending.jobs.retry(2, 'default', pending.job, fence, key(), true)
  await pending.jobs.tick({ 'import-apply': importApplyJob(fixture.db) }, pending.job)
  expect(
    fixture.sqlite.prepare('SELECT status FROM vc_crm_jobs WHERE id=?').get(pending.job)!.status,
  ).toBe('failed')
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()!.n).toBe(1)
})

it('retains an existing legacy source pointer and timestamp when a reviewed import adopts its provenance', async () => {
  fixture.close()
  fixture = await crmImportFixture((old) => {
    old.sqlite
      .prepare(
        "INSERT INTO vc_crm_source_identifiers(organization_id,site_id,domain,platform,external_id,record_id,created_at) SELECT organization_id,'default','contacts','Fictional old CRM','LEG001',?,'2020-01-01' FROM vc_sites WHERE id='default'",
      )
      .run(old.contact)
  })
  await apply({
    ...request('contacts', { sourceID: 'LEG001', firstName: 'Fictional adopted legacy contact' }),
    decision: 'update',
  })
  const identifier = fixture.sqlite
    .prepare('SELECT * FROM vc_crm_source_identifiers WHERE external_id=?')
    .get('LEG001')!
  expect(identifier.record_id).toBe(fixture.contact)
  expect(identifier.created_at).toBe('2020-01-01')
  expect(identifier.created_run_id).toBeTruthy()
  expect(identifier.revision).toBe(2)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_constituents').get()!.n).toBe(1)
})
