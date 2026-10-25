import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository } from '../../src/organizations/repository'
import { mergeSchemaV1 } from '../../src/crm/merge-schema-v1'
import {
  mergeReferenceRules,
  readMergeReferencePage,
  type MergeReferenceKind,
} from '../../src/crm/merge-references'

it('accounts for every current relational constituent reference and prepares every registered query', async () => {
  const fixture = await crmTimelineFixture()
  try {
    const duplicate = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: { kind: 'person', firstName: 'Fictional duplicate' },
          roles: ['donor'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    const tables = fixture.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vc_crm_%'")
      .all() as Array<{ name: string }>
    const actual = tables
      .flatMap(({ name }) =>
        (
          fixture.sqlite.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{
            table: string
            from: string
          }>
        )
          .filter((fk) => fk.table === 'vc_crm_constituents')
          .map((fk) => `${name}.${fk.from}`),
      )
      .sort()
    const tracked = Object.values(mergeReferenceRules)
      .flatMap((rule) => rule.columns.map((column) => `${rule.table}.${column}`))
      .sort()
    expect(tracked).toEqual(actual)
    for (const sql of mergeSchemaV1) fixture.sqlite.exec(sql)
    const organization = (await fixture.db
      .prepare('SELECT organization_id FROM vc_sites WHERE id=?')
      .bind('default')
      .first<{ organization_id: string }>())!.organization_id
    for (const kind of Object.keys(mergeReferenceRules) as MergeReferenceKind[]) {
      const page = await readMergeReferencePage(fixture.db, {
        organization,
        survivor: fixture.contact,
        duplicate,
        kind,
      })
      expect(page.next).toBeNull()
      expect(page.docs.every((row) => row.mergeSite === 'default')).toBe(true)
    }
  } finally {
    fixture.close()
  }
})

it('reads every original gift across pages without tuple deduplication or financial writes and rejects unrelated roots', async () => {
  const fixture = await crmTimelineFixture()
  for (const sql of mergeSchemaV1) fixture.sqlite.exec(sql)
  try {
    const duplicate = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: { kind: 'person', firstName: 'Fictional duplicate' },
          roles: ['donor'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    const finance = new FinanceRepository(fixture.db, 1)
    const fund = String(
      (
        await finance.createFund({
          site: 'default',
          name: 'Fictional merge fund',
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    for (let index = 0; index < 28; index++)
      await finance.createGift({
        site: 'default',
        constituent: index % 2 ? fixture.contact : duplicate,
        amount: { currency: 'USD', minorUnits: '90071992547409931' },
        exponent: 2,
        kind: 'cash',
        receivedOn: '2026-10-25',
        allocations: [{ fund, currency: 'USD', minorUnits: '90071992547409931' }],
        operationKey: crypto.randomUUID(),
      })
    const before = fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts ORDER BY id').all()
    const organization = (await fixture.db
      .prepare('SELECT organization_id FROM vc_sites WHERE id=?')
      .bind('default')
      .first<{ organization_id: string }>())!.organization_id
    const context = { organization, survivor: fixture.contact, duplicate, kind: 'gifts' as const }
    // Archived identity history still has to be preserved by a merge. The
    // internal inventory must not silently drop it like an active staff list.
    fixture.sqlite.prepare('UPDATE vc_crm_constituents SET archived=1 WHERE id=?').run(duplicate)
    const first = await readMergeReferencePage(fixture.db, context)
    expect(first.docs).toHaveLength(25)
    const second = await readMergeReferencePage(fixture.db, { ...context, after: first.next! })
    expect(second.docs).toHaveLength(3)
    expect(second.next).toBeNull()
    const all = [...first.docs, ...second.docs]
    expect(new Set(all.map((row) => row.mergeKey)).size).toBe(28)
    expect(all.every((row) => row.original_minor === '90071992547409931')).toBe(true)
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts ORDER BY id').all()).toEqual(before)
    await expect(
      readMergeReferencePage(fixture.db, { ...context, kind: '__proto__' as MergeReferenceKind }),
    ).rejects.toThrow(/valid merge inventory/)
    const other = await new OrganizationRepository(fixture.db, 1).createOrganization({
      name: 'Foreign merge root',
      siteName: 'Foreign merge chapter',
      operationKey: crypto.randomUUID(),
    })
    const foreign = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: String(other.site),
          profile: { kind: 'person', firstName: 'Foreign identity' },
          roles: ['contact'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    await expect(
      readMergeReferencePage(fixture.db, { ...context, duplicate: foreign }),
    ).rejects.toThrow(/same organization root/)
  } finally {
    fixture.close()
  }
})
