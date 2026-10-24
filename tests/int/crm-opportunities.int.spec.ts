import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { OpportunityRepository } from '../../src/crm/opportunities'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
let fixture: ReturnType<typeof localD1>,
  repo: OpportunityRepository,
  contact: string,
  pipeline: string,
  stages: Awaited<ReturnType<OpportunityRepository['stages']>>['docs']
const key = () => crypto.randomUUID()
const values = () => ({
  constituent: contact,
  name: 'Fictional major gift',
  pipeline,
  stage: stages[0].id,
  minorUnits: '90071992547409931',
  currency: 'USD',
  exponent: 2,
  owner: 1,
  nextAction: 'Call about proposal',
  nextOn: '2026-11-01',
  targetOn: '2026-12-31',
  notes: 'Private chapter discussion',
})
beforeEach(async () => {
  fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT);INSERT INTO users VALUES(1,'administrator','Operator'),(2,'editor','Fictional owner');",
  )
  for (const sql of [
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...financeSchemaV1,
    ...fundraisingSchemaV1,
    ...commitmentSchemaV1,
    ...opportunitySchemaV1,
  ])
    fixture.sqlite.exec(sql)
  repo = new OpportunityRepository(fixture.db, 1)
  contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional opportunity donor' },
        roles: ['donor'],
        operationKey: key(),
      })
    ).id,
  )
  pipeline = String(
    (
      await repo.savePipeline({
        site: 'default',
        operationKey: key(),
        values: { name: 'Major gifts' },
      })
    ).id,
  )
  stages = (await repo.stages('default', pipeline)).docs
})
afterEach(() => {
  vi.restoreAllMocks()
  fixture.close()
})
it('seeds configurable stages once and preserves original stage labels in history without creating revenue', async () => {
  expect(stages.map((s) => s.name)).toEqual([
    'Prospect',
    'Contacted',
    'Meeting',
    'Asked',
    'Committed',
    'Received',
    'Lost',
    'Declined',
  ])
  const input = { site: 'default', operationKey: key(), values: values() },
    created = await repo.save(input)
  expect(await repo.save(input)).toEqual(created)
  const id = String(created.id),
    moved = {
      ...values(),
      stage: stages[5].id,
      reason: 'Staff marked the conversation received; no gift recorded',
    }
  await repo.save({ site: 'default', id, expectedRevision: 1, operationKey: key(), values: moved })
  await repo.saveStage({
    site: 'default',
    id: stages[5].id,
    expectedRevision: 1,
    operationKey: key(),
    values: { pipeline, name: 'Completed conversation', outcome: 'won', position: 5 },
  })
  const detail = await repo.get('default', id)
  expect(detail.doc.expected_minor).toBe('90071992547409931')
  expect(detail.history.map((h) => h.to_label).sort()).toEqual(['Prospect', 'Received'])
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_gifts').get()!.n).toBe(0)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_commitments').get()!.n).toBe(0)
})
it('rejects stale moves and archived destinations atomically and retains history', async () => {
  const id = String(
    (await repo.save({ site: 'default', operationKey: key(), values: values() })).id,
  )
  await repo.save({
    site: 'default',
    id,
    expectedRevision: 1,
    operationKey: key(),
    values: { ...values(), stage: stages[1].id, reason: 'First outreach' },
  })
  const audits = fixture.sqlite.prepare('SELECT count(*) n FROM vc_platform_audit').get()!.n
  await expect(
    repo.save({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      values: { ...values(), stage: stages[2].id, reason: 'Stale meeting' },
    }),
  ).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_platform_audit').get()!.n).toBe(audits)
  expect((await repo.get('default', id)).history).toHaveLength(2)
  await repo.saveStage({
    site: 'default',
    id: stages[2].id,
    expectedRevision: 1,
    operationKey: key(),
    values: { pipeline, name: 'Meeting', outcome: 'open', position: 2, archived: true },
  })
  await expect(
    repo.save({
      site: 'default',
      id,
      expectedRevision: 2,
      operationKey: key(),
      values: { ...values(), stage: stages[2].id, reason: 'Invalid destination' },
    }),
  ).rejects.toThrow('active stage')
  expect(() =>
    fixture.sqlite.prepare('DELETE FROM vc_crm_opportunities WHERE id=?').run(id),
  ).toThrow()
})
it('links a recorded gift only by explicit action with retry and retained unlink history', async () => {
  const id = String(
      (await repo.save({ site: 'default', operationKey: key(), values: values() })).id,
    ),
    finance = new FinanceRepository(fixture.db, 1)
  const fund = String(
    (await finance.createFund({ site: 'default', name: 'General', operationKey: key() })).id,
  )
  const gift = String(
    (
      await finance.createGift({
        site: 'default',
        constituent: contact,
        amount: { currency: 'USD', minorUnits: '1000' },
        exponent: 2,
        kind: 'cash',
        receivedOn: '2026-10-24',
        allocations: [{ fund, currency: 'USD', minorUnits: '1000' }],
        reference: '',
        notes: '',
        operationKey: key(),
      })
    ).id,
  )
  const input = {
    site: 'default',
    id,
    expectedRevision: 1,
    operationKey: key(),
    gift,
    reason: 'Link existing receipt',
  }
  await repo.link(input)
  await repo.link(input)
  const detail = await repo.get('default', id)
  expect(detail.links).toHaveLength(1)
  expect(detail.doc.stage_id).toBe(stages[0].id)
  await repo.link({
    site: 'default',
    id,
    expectedRevision: 2,
    operationKey: key(),
    remove: detail.links[0].id,
    reason: 'Incorrect attribution; retain gift',
  })
  expect((await repo.get('default', id)).links[0].removed).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_gifts').get()!.n).toBe(1)
})
it('separates financial links from restricted activity and rejects revoked/foreign owners and contacts', async () => {
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
  const roster = await repo.owners('default')
  expect(roster.docs.map((o) => o.id)).toContain(2)
  const id = String(
    (await repo.save({ site: 'default', operationKey: key(), values: { ...values(), owner: 2 } }))
      .id,
  )
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    expectedRevision: revision(),
    denied: [{ category: 'finances', operation: 'read' }],
    operationKey: key(),
  })
  const restricted = await new OpportunityRepository(fixture.db, 2).get('default', id)
  expect(restricted.canFinance).toBe(false)
  expect(restricted.links).toEqual([])
  await expect(
    new OpportunityRepository(fixture.db, 2).link({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      gift: 'forged',
      reason: 'No access',
    }),
  ).rejects.toThrow()
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'editor',
    active: false,
    expectedRevision: revision(),
    operationKey: key(),
  })
  await expect(new OpportunityRepository(fixture.db, 2).get('default', id)).rejects.toThrow()
  await expect(
    repo.save({ site: 'default', operationKey: key(), values: { ...values(), owner: 2 } }),
  ).rejects.toThrow()
  const foreign = await authority.createOrganization({
    name: 'Unrelated root',
    siteName: 'Unrelated chapter',
    operationKey: key(),
  })
  await expect(repo.get(String(foreign.site), id)).rejects.toThrow()
})
it('uses complete counts and follows paginated matching records and due dates', async () => {
  for (let i = 0; i < 53; i++)
    await repo.save({
      site: 'default',
      operationKey: key(),
      values: { ...values(), name: `Prospect ${i}`, nextOn: i % 2 ? '2026-11-01' : '2027-01-01' },
    })
  const first = await repo.list({ site: 'default', pipeline })
  expect(first.total).toBe(53)
  expect(first.docs).toHaveLength(50)
  const next = await repo.list({ site: 'default', pipeline, after: first.next! })
  expect(next.docs).toHaveLength(3)
  expect(next.total).toBe(53)
  expect((await repo.list({ site: 'default', dueThrough: '2026-12-01' })).total).toBe(26)
  const stale = first.docs[0]
  // Simulate a separately archived chapter affiliation; shared identity remains intact.
  fixture.sqlite
    .prepare(
      "UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE site_id='default' AND constituent_id=?",
    )
    .run(contact)
  expect((await repo.list({ site: 'default' })).total).toBe(0)
  await expect(repo.get('default', stale.id)).rejects.toThrow()
})
it('fences a stage archived between validation and commit without retaining a record or audit', async () => {
  const before = fixture.sqlite.prepare('SELECT count(*) n FROM vc_platform_audit').get()!.n
  const batch = fixture.db.batch.bind(fixture.db)
  vi.spyOn(fixture.db, 'batch').mockImplementationOnce(async (statements) => {
    fixture.sqlite
      .prepare('UPDATE vc_crm_opportunity_stages SET archived=1,revision=revision+1 WHERE id=?')
      .run(stages[0].id)
    return batch(statements)
  })
  await expect(
    repo.save({ site: 'default', operationKey: key(), values: values() }),
  ).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_opportunities').get()!.n).toBe(0)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_platform_audit').get()!.n).toBe(before)
  expect(
    fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_opportunity_stage_history').get()!.n,
  ).toBe(0)
})
