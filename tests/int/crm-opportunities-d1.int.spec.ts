import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { opportunitySchemaV1 } from '../../src/crm/opportunity-schema-v1'
import { ContactRepository } from '../../src/crm/contacts'
import { OpportunityRepository } from '../../src/crm/opportunities'
let proxy: PlatformProxy<{ D1: D1Database }>, db: D1Database
beforeAll(async () => {
  proxy = await getPlatformProxy<{ D1: D1Database }>({
    configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
    persist: false,
    remoteBindings: false,
  })
  db = proxy.env.D1
  const statements = [
    'CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT)',
    "INSERT INTO users VALUES(1,'administrator','Fictional operator')",
    ...organizationSchema,
    ...defaultOrganizationSeed,
    ...contactSchemaV1,
    ...financeSchemaV1,
    ...fundraisingSchemaV1,
    ...commitmentSchemaV1,
    ...opportunitySchemaV1,
  ]
  for (let i = 0; i < statements.length; i += 25)
    await db.batch(statements.slice(i, i + 25).map((s) => db.prepare(s)))
}, 90000)
afterAll(async () => {
  await proxy?.dispose()
})
it('persists an opportunity and stage/audit events atomically on real D1 without implicit finance writes', async () => {
  const key = () => crypto.randomUUID(),
    repo = new OpportunityRepository(db, 1)
  const contact = String(
    (
      await new ContactRepository(db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional D1 prospect' },
        roles: ['contact'],
        operationKey: key(),
      })
    ).id,
  )
  const pipeline = String(
    (
      await repo.savePipeline({
        site: 'default',
        operationKey: key(),
        values: { name: 'D1 campaign prospects' },
      })
    ).id,
  )
  const stages = (await repo.stages('default', pipeline)).docs
  const values = {
    name: 'Fictional D1 proposal',
    constituent: contact,
    pipeline,
    stage: stages[0].id,
    minorUnits: '999999999999999999',
    currency: 'USD',
    exponent: 2,
  }
  const create = { site: 'default', operationKey: key(), values },
    result = await repo.save(create)
  expect(await repo.save(create)).toEqual(result)
  const id = String(result.id)
  await repo.save({
    site: 'default',
    id,
    expectedRevision: 1,
    operationKey: key(),
    values: { ...values, stage: stages[5].id, reason: 'Outcome tracking only' },
  })
  const before = await db.prepare('SELECT count(*) n FROM vc_platform_audit').first()
  await expect(
    repo.save({
      site: 'default',
      id,
      expectedRevision: 1,
      operationKey: key(),
      values: { ...values, stage: stages[2].id, reason: 'Stale move' },
    }),
  ).rejects.toThrow()
  expect(await db.prepare('SELECT count(*) n FROM vc_platform_audit').first()).toEqual(before)
  const detail = await repo.get('default', id)
  expect(detail.history.map((h) => h.to_label)).toEqual(['Prospect', 'Received'])
  expect(detail.doc.revision).toBe(2)
  expect((await db.prepare('SELECT count(*) n FROM vc_crm_gifts').first<{ n: number }>())!.n).toBe(
    0,
  )
  expect(
    (await db.prepare('SELECT count(*) n FROM vc_crm_commitments').first<{ n: number }>())!.n,
  ).toBe(0)
}, 90000)
