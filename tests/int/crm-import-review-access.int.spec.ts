import { afterEach, beforeEach, expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { reviewedCRMImport, finishReviewedImport } from '../helpers/reviewed-crm-import'
import { authorizedImportReview } from '../../src/crm/import-review-access'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
let fixture: Awaited<ReturnType<typeof crmImportFixture>>
const key = () => crypto.randomUUID(),
  cells = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([field, value]) => [
        field,
        { value, clear: !value.trim(), referenceMode: 'record' as const },
      ]),
    )
beforeEach(async () => {
  fixture = await crmImportFixture()
})
afterEach(() => fixture.close())
it('denies a cached issued gift review after the linked donor affiliation is revoked', async () => {
  const fund = String(
    (
      await new FinanceRepository(fixture.db, 1).createFund({
        site: 'default',
        name: 'Fictional review access fund',
        operationKey: key(),
      })
    ).id,
  )
  const queued = await reviewedCRMImport(fixture, [
    {
      site: 'default',
      domain: 'gifts',
      sourceSystem: 'Fictional source',
      decision: 'create',
      values: cells({
        sourceID: 'Gift-1',
        contact: fixture.contact,
        fund,
        amount: '123.45',
        currency: 'USD',
        exponent: '2',
        receivedOn: '2026-10-25',
      }),
    },
  ])
  const [row] = await finishReviewedImport(fixture, queued)
  expect(
    (await authorizedImportReview(fixture.db, 1, 'default', queued.id, row)).visibility.contacts,
  ).toContain(fixture.contact)
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1,revision=revision+1 WHERE constituent_id=?')
    .run(fixture.contact)
  await expect(authorizedImportReview(fixture.db, 1, 'default', queued.id, row)).rejects.toThrow()
})
it('allows the owner to read retained snapshots with read access but denies newly restricted reference categories', async () => {
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
        name: 'Fictional owner review fund',
        operationKey: key(),
      })
    ).id,
  )
  const queued = await reviewedCRMImport(
    fixture,
    [
      {
        site: 'default',
        domain: 'gifts',
        sourceSystem: 'Fictional source',
        decision: 'create',
        values: cells({
          sourceID: 'Gift-1',
          contact: fixture.contact,
          fund,
          amount: '10.00',
          currency: 'USD',
          exponent: '2',
          receivedOn: '2026-10-25',
        }),
      },
    ],
    { actor: 2 },
  )
  const [row] = await finishReviewedImport(fixture, queued)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'finances', operation: 'edit' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  expect(
    (await authorizedImportReview(fixture.db, 2, 'default', queued.id, row)).after,
  ).toBeTruthy()
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'finances', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  await expect(authorizedImportReview(fixture.db, 2, 'default', queued.id, row)).rejects.toThrow()
})
