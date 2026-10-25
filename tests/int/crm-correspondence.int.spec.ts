import { afterEach, beforeEach, expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { correspondenceSchemaV1 } from '../../src/crm/correspondence-schema-v1'
import { CorrespondenceRepository } from '../../src/crm/correspondence'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { financeSchemaV1 } from '../../src/crm/finance-schema-v1'
import { contactDocumentSnapshot } from '../../src/crm/correspondence-snapshot'
import { CorrespondenceDocuments } from '../../src/crm/correspondence-documents'
import { householdSchemaV1 } from '../../src/crm/household-schema-v1'
import { fundraisingSchemaV1 } from '../../src/crm/fundraising-schema-v1'
import { commitmentSchemaV1 } from '../../src/crm/commitment-schema-v1'
import { membershipSchemaV1 } from '../../src/crm/membership-schema-v1'
import { MembershipRepository } from '../../src/crm/memberships'
import { OrganizationRepository } from '../../src/organizations/repository'
import { crmJobSchemaV1 } from '../../src/crm/job-schema-v1'
let fixture: ReturnType<typeof localD1>, repository: CorrespondenceRepository
beforeEach(() => {
  fixture = localD1()
  fixture.sqlite.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'administrator'),(2,'editor');",
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
    ...crmJobSchemaV1,
    ...correspondenceSchemaV1,
  ])
    fixture.sqlite.exec(sql)
  repository = new CorrespondenceRepository(fixture.db, 1)
})
it('includes every annual gift across pages and rejects a concurrent insertion at issuance', async () => {
  const contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Annual recipient' },
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
        name: 'Annual fund',
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const gift = String(
    (
      await finance.createGift({
        site: 'default',
        constituent: contact,
        amount: { currency: 'USD', minorUnits: '100' },
        exponent: 2,
        kind: 'cash',
        receivedOn: '2026-01-01',
        allocations: [{ fund, currency: 'USD', minorUnits: '100' }],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const columns = (
    fixture.sqlite.prepare('PRAGMA table_info(vc_crm_gifts)').all() as { name: string }[]
  ).map((column) => column.name)
  const clone = fixture.sqlite.prepare(
    `INSERT INTO vc_crm_gifts(${columns.join(',')}) SELECT ${columns.map((column) => (column === 'id' ? '?' : column)).join(',')} FROM vc_crm_gifts WHERE id=?`,
  )
  for (let index = 0; index < 204; index++) clone.run(`annual-${index}`, gift)
  const template = String(
    (
      await repository.saveTemplate({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: { ...values, kind: 'annual-statement' },
      })
    ).id,
  )
  const documents = new CorrespondenceDocuments(fixture.db, 1),
    request = {
      site: 'default',
      contact,
      template,
      year: 2026,
      issuedOn: '2026-10-24',
      issuerName: 'Fictional nonprofit',
      issuerAddress: '',
    }
  const preview = await documents.preview(request)
  expect(preview.snapshot.annual).toHaveLength(205)
  expect(preview.snapshot.giving?.totals[0].minorUnits).toBe('20500')
  const originalBatch = fixture.db.batch.bind(fixture.db)
  fixture.db.batch = (async (statements) => {
    clone.run('annual-concurrent', gift)
    fixture.db.batch = originalBatch
    return originalBatch(statements)
  }) as typeof fixture.db.batch
  await expect(
    documents.issue({ ...request, approval: preview.approval, operationKey: crypto.randomUUID() }),
  ).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_documents').get()).toEqual({
    n: 0,
  })
  const current = await documents.preview(request)
  const issued = await documents.issue({
    ...request,
    approval: current.approval,
    operationKey: crypto.randomUUID(),
  })
  expect((await documents.get('default', String(issued.id))).body).toContain('USD 206.00')
})
it('records renewal correspondence from a membership term without creating renewal or payment records', async () => {
  const contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Renewal recipient' },
        roles: ['member'],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const memberships = new MembershipRepository(fixture.db, 1)
  const type = String(
    (
      await memberships.saveType({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: {
          name: 'Annual membership',
          eligibility: 'person',
          termMonths: 12,
          minorUnits: '0',
          currency: 'USD',
          exponent: 2,
        },
      })
    ).id,
  )
  const membership = String(
    (
      await memberships.enroll({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: { type, typeRevision: 1, person: contact, startsOn: '2026-01-01' },
      })
    ).id,
  )
  const template = String(
    (
      await repository.saveTemplate({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: {
          ...values,
          kind: 'membership-renewal',
          body: '{{membership.type}} ends {{membership.endsOn}}',
        },
      })
    ).id,
  )
  const documents = new CorrespondenceDocuments(fixture.db, 1),
    request = {
      site: 'default',
      contact,
      template,
      membership,
      issuedOn: '2026-10-24',
      issuerName: 'Fictional nonprofit',
      issuerAddress: '',
    }
  const preview = await documents.preview(request)
  expect(preview.snapshot.body).toContain('Annual membership ends 2026-12-31')
  const issued = await documents.issue({
    ...request,
    approval: preview.approval,
    operationKey: crypto.randomUUID(),
  })
  expect((await documents.get('default', String(issued.id))).membership).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_membership_terms').get()).toEqual(
    { n: 1 },
  )
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_gifts').get()).toEqual({ n: 0 })
})
it('resolves authorized previews, issues immutable receipts and rejects stale financial approvals', async () => {
  const contact = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional recipient' },
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
        name: 'General',
        operationKey: crypto.randomUUID(),
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
        receivedOn: '2026-10-24',
        allocations: [{ currency: 'USD', minorUnits: '1000', fund }],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const template = String(
    (await repository.saveTemplate({ site: 'default', operationKey: crypto.randomUUID(), values }))
      .id,
  )
  const request = {
    site: 'default',
    contact,
    template,
    gift,
    issuedOn: '2026-10-24',
    issuerName: 'Fictional nonprofit',
    issuerAddress: 'Fictional address',
  }
  const snapshot = await contactDocumentSnapshot(fixture.db, 1, request)
  expect(snapshot.body).toContain('Dear Fictional recipient')
  expect(snapshot.body).toContain('current net USD 10.00')
  expect(snapshot.financial).toBe(true)
  expect(snapshot.gift?.revision).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_documents').get()).toEqual({
    n: 0,
  })
  await expect(
    contactDocumentSnapshot(fixture.db, 1, { ...request, gift: undefined }),
  ).rejects.toThrow('recorded gift')
  await expect(
    contactDocumentSnapshot(fixture.db, 1, { ...request, gift: 'other-contact-gift' }),
  ).rejects.toThrow()
  await expect(contactDocumentSnapshot(fixture.db, 2, request)).rejects.toThrow()
  const documents = new CorrespondenceDocuments(fixture.db, 1)
  const preview = await documents.preview(request)
  const issue = { ...request, approval: preview.approval, operationKey: crypto.randomUUID() }
  const issued = await documents.issue(issue)
  expect(await documents.issue(issue)).toEqual(issued)
  const original = await documents.get('default', String(issued.id))
  expect(original.body).toContain('current net USD 10.00')
  expect(() => fixture.sqlite.exec("UPDATE vc_crm_documents SET body='changed'")).toThrow(
    'immutable',
  )
  expect(() => fixture.sqlite.exec('DELETE FROM vc_crm_documents')).toThrow('retained')
  await finance.adjust({
    site: 'default',
    id: gift,
    action: 'refund',
    deltaMinor: '-250',
    reason: 'Fictional partial refund',
    expectedRevision: 1,
    operationKey: crypto.randomUUID(),
  })
  await expect(documents.issue({ ...issue, operationKey: crypto.randomUUID() })).rejects.toThrow()
  expect((await documents.get('default', String(issued.id))).body).toBe(original.body)
  const correctedPreview = await documents.preview({ ...request, supersedes: String(issued.id) })
  expect(correctedPreview.snapshot.body).toContain(`supersedes document ${issued.id}`)
  const corrected = await documents.issue({
    ...request,
    approval: correctedPreview.approval,
    supersedes: String(issued.id),
    operationKey: crypto.randomUUID(),
  })
  const correction = await documents.get('default', String(corrected.id))
  expect(correction.supersedes_id).toBe(issued.id)
  expect(correction.body).toContain('current net USD 7.50')
  expect(correction.body).toContain(`supersedes document ${issued.id}`)
  expect(await documents.printable('default', String(corrected.id))).toContain(
    `supersedes document ${issued.id}`,
  )
  expect(await documents.printable('default', String(corrected.id))).toContain(
    'Fictional nonprofit',
  )
  expect((await documents.list('default', contact)).docs).toHaveLength(2)
  const authority = new OrganizationRepository(fixture.db, 1)
  const siteRevision = () =>
    Number(
      (
        fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get() as {
          revision: number
        }
      ).revision,
    )
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'reader',
    active: true,
    expectedRevision: siteRevision(),
    operationKey: crypto.randomUUID(),
  })
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'finances', operation: 'read' }],
    expectedRevision: siteRevision(),
    operationKey: crypto.randomUUID(),
  })
  const restricted = new CorrespondenceDocuments(fixture.db, 2)
  expect((await restricted.list('default', contact)).docs).toEqual([])
  await expect(restricted.get('default', String(issued.id))).rejects.toThrow()
  const generalTemplate = String(
    (
      await repository.saveTemplate({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: { ...values, name: 'General letter', kind: 'general' },
      })
    ).id,
  )
  const generalRequest = {
    ...request,
    template: generalTemplate,
    gift: undefined as string | undefined,
  }
  const generalPreview = await documents.preview(generalRequest)
  await documents.issue({
    ...generalRequest,
    approval: generalPreview.approval,
    operationKey: crypto.randomUUID(),
  })
  expect((await restricted.list('default', contact)).docs.map((doc) => doc.kind)).toEqual([
    'general',
  ])
  await expect(
    new CorrespondenceDocuments(fixture.db, 999).get('default', String(issued.id)),
  ).rejects.toThrow()
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
    .run(contact)
  await expect(contactDocumentSnapshot(fixture.db, 1, request)).rejects.toThrow()
  await expect(documents.get('default', String(issued.id))).rejects.toThrow()
})
afterEach(() => fixture.close())
const values = {
  name: 'Fictional receipt',
  kind: 'gift-receipt',
  subject: 'Thank you',
  body: 'Dear {{recipient.name}}',
}
it('retains immutable prior template versions, rejects stale saves and replays intent-bound operations', async () => {
  const request = { site: 'default', operationKey: crypto.randomUUID(), values }
  const created = await repository.saveTemplate(request)
  expect(await repository.saveTemplate(request)).toEqual(created)
  const changed = await repository.saveTemplate({
    site: 'default',
    id: String(created.id),
    expectedRevision: 1,
    operationKey: crypto.randomUUID(),
    values: { ...values, body: 'Updated {{recipient.name}}' },
  })
  expect(changed.revision).toBe(2)
  expect(
    fixture.sqlite
      .prepare('SELECT body FROM vc_crm_template_versions WHERE template_id=? ORDER BY revision')
      .all(String(created.id)),
  ).toEqual([{ body: values.body }, { body: 'Updated {{recipient.name}}' }])
  await expect(
    repository.saveTemplate({
      site: 'default',
      id: String(created.id),
      expectedRevision: 1,
      operationKey: crypto.randomUUID(),
      values,
    }),
  ).rejects.toThrow()
  await expect(
    repository.saveTemplate({ ...request, values: { ...values, subject: 'Other' } }),
  ).rejects.toThrow()
  expect(() => fixture.sqlite.exec("UPDATE vc_crm_template_versions SET body='rewritten'")).toThrow(
    'immutable',
  )
  expect(() => fixture.sqlite.exec('DELETE FROM vc_crm_template_versions')).toThrow('retained')
  expect((await repository.templates('default')).docs[0].body).toBe('Updated {{recipient.name}}')
})
it('honors existing default-site read access while denying ungranted edits and missing contexts', async () => {
  expect((await new CorrespondenceRepository(fixture.db, 2).templates('default')).canEdit).toBe(
    false,
  )
  await expect(new CorrespondenceRepository(fixture.db, 999).templates('default')).rejects.toThrow()
  await expect(
    new CorrespondenceRepository(fixture.db, 2).saveTemplate({
      site: 'default',
      operationKey: crypto.randomUUID(),
      values,
    }),
  ).rejects.toThrow()
  await expect(
    repository.saveTemplate({ site: 'missing', operationKey: crypto.randomUUID(), values }),
  ).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_templates').get()).toEqual({
    n: 0,
  })
})
