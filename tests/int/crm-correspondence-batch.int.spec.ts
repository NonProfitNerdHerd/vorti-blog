import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { correspondenceBatchSchemaV1 } from '../../src/crm/correspondence-batch-schema-v1'
import { CorrespondenceBatches } from '../../src/crm/correspondence-batches'
import { CorrespondenceRepository } from '../../src/crm/correspondence'
import { ContactRepository } from '../../src/crm/contacts'
import { CorrespondenceDocuments } from '../../src/crm/correspondence-documents'
import { correspondenceBatchJob } from '../../src/crm/correspondence-batch-job'
import { CRMJobs } from '../../src/crm/jobs'
import { correspondenceCandidates } from '../../src/crm/correspondence-batch-selection'
import { OrganizationRepository } from '../../src/organizations/repository'
import { FinanceRepository } from '../../src/crm/finance'
import { MembershipRepository } from '../../src/crm/memberships'

let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>,
  batches: CorrespondenceBatches,
  template: string
const key = () => crypto.randomUUID()
const values = () => ({
  template,
  issuedOn: '2026-10-24',
  issuerName: 'Fictional charity',
  issuerAddress: 'Fictional office',
})
beforeEach(async () => {
  fixture = await crmTimelineFixture()
  for (const sql of correspondenceBatchSchemaV1) fixture.sqlite.exec(sql)
  template = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional bulk letter',
          kind: 'general',
          subject: 'Hello {{recipient.name}}',
          body: 'A fictional letter for {{recipient.name}}.',
        },
      })
    ).id,
  )
  batches = new CorrespondenceBatches(fixture.db, 1)
})
afterEach(() => {
  fixture.close()
  vi.restoreAllMocks()
})
const create = async () =>
  String(
    (
      await batches.save({
        site: 'default',
        name: 'Fictional bulk run',
        operationKey: key(),
        values: values(),
      })
    ).id,
  )
async function prepare(id: string, contact = fixture.contact) {
  const current = await batches.get('default', id)
  return batches.prepareRecipient({
    site: 'default',
    id,
    expectedRevision: current.doc.revision,
    operationKey: key(),
    recipient: { contact },
  })
}
async function approve(id: string) {
  const page = await batches.get('default', id)
  return batches.approve({
    site: 'default',
    id,
    expectedRevision: page.doc.revision,
    operationKey: key(),
  })
}
async function runBatch(limit = 50) {
  const runner = new CRMJobs(fixture.db)
  // Child PDF jobs are exercised by the separate document handler suite. Select only batch jobs here.
  const handler = correspondenceBatchJob(fixture.db)
  for (let index = 0; index < limit; index++) {
    const next = fixture.sqlite
      .prepare(
        "SELECT id FROM vc_crm_jobs WHERE json_extract(payload,'$.batch') IS NOT NULL AND status IN('pending','running')",
      )
      .get()
    if (!next) return
    await runner.tick({
      correspondence: {
        prepare: async (job) => {
          if (!JSON.parse(job.payload).batch)
            return { writes: [], cursor: job.id, processed: 0, done: true }
          return handler.prepare(job)
        },
      },
    })
  }
  throw new Error('Batch did not reach a terminal state.')
}

it('retains draft reviews without issuance, validates every recipient first, and issues exactly once on durable retries', async () => {
  const id = await create(),
    other = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          operationKey: key(),
          profile: { kind: 'person', firstName: 'Fictional second recipient' },
          roles: ['contact'],
        })
      ).id,
    )
  const saved = await prepare(id),
    retryKey = key(),
    current = await batches.get('default', id)
  const mutation = {
    site: 'default',
    id,
    expectedRevision: current.doc.revision,
    operationKey: retryKey,
    recipient: { contact: other },
  }
  expect(await batches.prepareRecipient(mutation)).toEqual(await batches.prepareRecipient(mutation))
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
  expect((await batches.get('default', id)).totals).toEqual({ total: 2, issued: 0, stale: 0 })
  const approval = await approve(id),
    runner = new CRMJobs(fixture.db),
    handler = correspondenceBatchJob(fixture.db)
  await runner.tick({ correspondence: handler })
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
  expect(
    fixture.sqlite
      .prepare(
        'SELECT count(*) n FROM vc_crm_correspondence_recipients WHERE validated_revision IS NOT NULL',
      )
      .get()!.n,
  ).toBe(1)
  await runBatch()
  const done = await batches.get('default', id)
  expect(done.job?.status).toBe('completed')
  expect(done.totals.issued).toBe(2)
  expect(new Set(done.items.map((row) => row.document)).size).toBe(2)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) n FROM vc_platform_audit WHERE action='document.issued'")
      .get()!.n,
  ).toBe(2)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_email_outbox').get()!.n).toBe(0)
  expect(saved.recipient).toBeTruthy()
  expect(approval.job).toBeTruthy()
  await expect(batches.prepareRecipient({ ...mutation, operationKey: key() })).rejects.toThrow()
})

it('rejects stale batch edits, incomplete reviews and changed source data before issuing any document', async () => {
  const id = await create(),
    stale = (await batches.get('default', id)).doc.revision
  await prepare(id)
  await expect(
    batches.approve({ site: 'default', id, expectedRevision: stale, operationKey: key() }),
  ).rejects.toThrow()
  const row = fixture.sqlite
    .prepare('SELECT constituent_id FROM vc_crm_correspondence_recipients WHERE batch_id=?')
    .get(id)!
  fixture.sqlite
    .prepare(
      "UPDATE vc_crm_constituents SET label='Fictional changed recipient',revision=revision+1 WHERE id=?",
    )
    .run(row.constituent_id)
  await approve(id)
  await runBatch()
  const failed = await batches.get('default', id)
  expect(failed.job?.status).toBe('failed')
  expect(failed.job?.error).toContain('Refresh pending reviews')
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
  await batches.reopen({
    site: 'default',
    id,
    expectedRevision: failed.doc.revision,
    operationKey: key(),
  })
  await prepare(id)
  await approve(id)
  await runBatch()
  expect((await batches.get('default', id)).totals.issued).toBe(1)
})

it('fences a cancelled issuance checkpoint, preserves already issued documents, and resumes remaining selections after review', async () => {
  const id = await create()
  await prepare(id)
  await approve(id)
  const handler = correspondenceBatchJob(fixture.db),
    runner = new CRMJobs(fixture.db)
  await runner.tick({ correspondence: handler })
  await runner.tick({ correspondence: handler })
  const original = handler.prepare
  handler.prepare = async (job) => {
    const step = await original(job)
    await batches.control({
      site: 'default',
      id,
      job: job.id,
      expectedFence: job.fence,
      action: 'cancel',
      operationKey: key(),
    })
    return step
  }
  await runner.tick({ correspondence: handler })
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
  const cancelled = await batches.get('default', id)
  expect(cancelled.job?.status).toBe('cancelled')
  await batches.reopen({
    site: 'default',
    id,
    expectedRevision: cancelled.doc.revision,
    operationKey: key(),
  })
  await prepare(id)
  await approve(id)
  await runBatch()
  const issued = (await batches.get('default', id)).items[0].document
  const complete = await batches.get('default', id)
  await batches.reopen({
    site: 'default',
    id,
    expectedRevision: complete.doc.revision,
    operationKey: key(),
  })
  await expect(prepare(id)).rejects.toThrow('already has an issued document')
  await expect(
    batches.remove({
      site: 'default',
      id,
      expectedRevision: (await batches.get('default', id)).doc.revision,
      recipient: complete.items[0].id,
      operationKey: key(),
    }),
  ).rejects.toThrow()
  expect((await new CorrespondenceDocuments(fixture.db, 1).get('default', issued!)).id).toBe(issued)
})

it('invalidates reviews after configuration/permission changes and hides private batch metadata after access revocation', async () => {
  const id = await create()
  await prepare(id)
  let page = await batches.get('default', id)
  await batches.save({
    site: 'default',
    id,
    expectedRevision: page.doc.revision,
    name: page.doc.name,
    operationKey: key(),
    values: { ...values(), issuerName: 'Fictional corrected issuer' },
  })
  page = await batches.get('default', id)
  expect(page.totals.stale).toBe(1)
  await expect(approve(id)).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_jobs').get()!.n).toBe(0)
  await prepare(id)
  const authority = new OrganizationRepository(fixture.db, 1)
  await authority.setMembership({
    site: 'default',
    user: 2,
    role: 'reader',
    active: true,
    expectedRevision: Number(
      fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision,
    ),
    operationKey: key(),
  })
  await expect(approve(id)).rejects.toThrow()
  expect((await new CorrespondenceBatches(fixture.db, 2).get('default', id)).canEdit).toBe(false)
  fixture.sqlite
    .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
    .run(fixture.contact)
  await expect(batches.get('default', id)).rejects.toThrow()
  expect((await batches.list('default')).docs).toHaveLength(0)
})

it('returns every matching candidate and complete counts across pages without silent caps', async () => {
  const id = await create(),
    contacts = new ContactRepository(fixture.db, 1)
  for (let index = 0; index < 56; index++)
    await contacts.create({
      site: 'default',
      operationKey: key(),
      profile: { kind: 'person', firstName: `Fictional bulk candidate ${index}` },
      roles: ['contact'],
    })
  const page = await correspondenceCandidates(fixture.db, 1, {
    site: 'default',
    batch: id,
    search: 'Fictional bulk candidate',
  })
  expect(page.total).toBe(56)
  expect(page.docs).toHaveLength(50)
  const next = await correspondenceCandidates(fixture.db, 1, {
    site: 'default',
    batch: id,
    search: 'Fictional bulk candidate',
    after: page.next!,
  })
  expect(next.total).toBe(56)
  expect(next.docs).toHaveLength(6)
  expect(new Set([...page.docs, ...next.docs].map((row) => row.id)).size).toBe(56)
  await expect(
    correspondenceCandidates(fixture.db, 1, {
      site: 'default',
      batch: id,
      from: '2026-11-01',
      through: '2026-10-01',
    }),
  ).rejects.toThrow()
})

it('issues every prepared recipient across pages and retains original links when additional recipients are approved later', async () => {
  const id = await create(),
    contacts = new ContactRepository(fixture.db, 1)
  const added: string[] = []
  for (let index = 0; index < 53; index++) {
    const contact = String(
      (
        await contacts.create({
          site: 'default',
          operationKey: key(),
          profile: { kind: 'person', firstName: `Fictional paged letter ${index}` },
          roles: ['contact'],
        })
      ).id,
    )
    added.push(contact)
    await prepare(id, contact)
  }
  const first = await batches.get('default', id),
    second = await batches.get('default', id, first.next!)
  expect(first.totals.total).toBe(53)
  expect(first.items).toHaveLength(50)
  expect(second.items).toHaveLength(3)
  expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(53)
  await approve(id)
  await runBatch(300)
  let done = await batches.get('default', id)
  expect(done.totals.issued).toBe(53)
  const original = done.items[0].document
  await batches.reopen({
    site: 'default',
    id,
    expectedRevision: done.doc.revision,
    operationKey: key(),
  })
  await prepare(id, fixture.contact)
  await approve(id)
  await runBatch(300)
  done = await batches.get('default', id)
  expect(done.totals.issued).toBe(54)
  expect(
    fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents WHERE id=?').get(original)!.n,
  ).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(54)
  await expect(
    correspondenceCandidates(fixture.db, 1, {
      site: 'default',
      batch: id,
    }),
  ).rejects.toThrow('Reopen the batch')
}, 60000)

it('selects separate recorded gifts for receipts and complete annual statements while excluding in-kind valuations', async () => {
  const finance = new FinanceRepository(fixture.db, 1),
    fund = String(
      (
        await finance.createFund({
          site: 'default',
          name: 'Fictional batch fund',
          operationKey: key(),
        })
      ).id,
    )
  const gifts: string[] = []
  for (const [kind, minorUnits] of [
    ['cash', '100'],
    ['cash', '100'],
    ['in-kind', '12345'],
  ] as const)
    gifts.push(
      String(
        (
          await finance.createGift({
            site: 'default',
            constituent: fixture.contact,
            kind,
            receivedOn: '2026-10-24',
            amount: { currency: 'USD', minorUnits },
            exponent: 2,
            allocations: [{ fund, currency: 'USD', minorUnits }],
            reference: 'Fictional distinct source',
            operationKey: key(),
          })
        ).id,
      ),
    )
  const receiptTemplate = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional bulk receipt',
          kind: 'gift-receipt',
          subject: 'Recorded gift for {{recipient.name}}',
          body: '{{giving.summary}}',
        },
      })
    ).id,
  )
  const id = String(
    (
      await batches.save({
        site: 'default',
        name: 'Fictional receipts',
        operationKey: key(),
        values: { ...values(), template: receiptTemplate },
      })
    ).id,
  )
  const page = await correspondenceCandidates(fixture.db, 1, { site: 'default', batch: id })
  expect(page.total).toBe(3)
  expect(new Set(page.docs.map((row) => row.id)).size).toBe(3)
  expect(page.docs.find((row) => row.id === gifts[2])?.detail).not.toContain('123.45')
  for (const candidate of page.docs) {
    const current = await batches.get('default', id)
    await batches.prepareRecipient({
      site: 'default',
      id,
      expectedRevision: current.doc.revision,
      operationKey: key(),
      recipient: candidate.recipient,
    })
  }
  await approve(id)
  await runBatch()
  expect((await batches.get('default', id)).totals.issued).toBe(3)
  const annualTemplate = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional annual batch',
          kind: 'annual-statement',
          subject: 'Annual history',
          body: '{{giving.summary}}',
        },
      })
    ).id,
  )
  const annual = String(
    (
      await batches.save({
        site: 'default',
        name: 'Fictional statements',
        operationKey: key(),
        values: { ...values(), template: annualTemplate, year: 2026 },
      })
    ).id,
  )
  const annualCandidates = await correspondenceCandidates(fixture.db, 1, {
    site: 'default',
    batch: annual,
  })
  expect(annualCandidates.total).toBe(1)
  await prepare(annual)
  await approve(annual)
  await runBatch()
  const statement = (await batches.get('default', annual)).items[0]
  const document = await new CorrespondenceDocuments(fixture.db, 1).get(
    'default',
    statement.document!,
  )
  expect(document.body).toContain('USD 2.00')
  expect(document.body).not.toContain('123.45')
  expect(JSON.parse(document.snapshot).annual).toHaveLength(3)
})

it('selects billing membership terms for renewal letters without recording a renewal or payment', async () => {
  const membership = new MembershipRepository(fixture.db, 1)
  const type = String(
    (
      await membership.saveType({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional batch membership',
          eligibility: 'person',
          termMonths: 12,
          minorUnits: '0',
          currency: 'USD',
          exponent: 2,
        },
      })
    ).id,
  )
  const term = String(
    (
      await membership.enroll({
        site: 'default',
        operationKey: key(),
        values: { type, typeRevision: 1, person: fixture.contact, startsOn: '2026-01-01' },
      })
    ).id,
  )
  const renewalTemplate = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional renewal batch',
          kind: 'membership-renewal',
          subject: 'Renewal for {{recipient.name}}',
          body: 'Recorded term {{membership.type}} ends {{membership.endsOn}}.',
        },
      })
    ).id,
  )
  const id = String(
    (
      await batches.save({
        site: 'default',
        name: 'Fictional renewal letters',
        operationKey: key(),
        values: { ...values(), template: renewalTemplate },
      })
    ).id,
  )
  const sources = await correspondenceCandidates(fixture.db, 1, {
    site: 'default',
    batch: id,
    from: '2026-12-01',
    through: '2026-12-31',
  })
  expect(sources.total).toBe(1)
  expect(sources.docs[0].recipient.membership).toBe(term)
  await batches.prepareRecipient({
    site: 'default',
    id,
    expectedRevision: 1,
    operationKey: key(),
    recipient: sources.docs[0].recipient,
  })
  await approve(id)
  await runBatch()
  const document = await new CorrespondenceDocuments(fixture.db, 1).get(
    'default',
    (await batches.get('default', id)).items[0].document!,
  )
  expect(document.body).toContain('does not record a renewal or payment')
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_membership_terms').get()!.n).toBe(1)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_gifts').get()!.n).toBe(0)
})

it('applies aggregate financial access and owner/site boundaries to batch labels, counts and processing', async () => {
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
  const financialTemplate = String(
    (
      await new CorrespondenceRepository(fixture.db, 1).saveTemplate({
        site: 'default',
        operationKey: key(),
        values: {
          name: 'Fictional restricted annual template',
          kind: 'annual-statement',
          subject: 'Private annual history',
          body: '{{giving.summary}}',
        },
      })
    ).id,
  )
  const other = new CorrespondenceBatches(fixture.db, 2),
    id = String(
      (
        await other.save({
          site: 'default',
          name: 'Fictional private financial batch',
          operationKey: key(),
          values: { ...values(), template: financialTemplate, year: 2026 },
        })
      ).id,
    )
  expect((await other.list('default')).docs).toHaveLength(1)
  expect((await batches.get('default', id)).canEdit).toBe(false)
  await expect(batches.process('default', id, {} as R2Bucket)).rejects.toThrow()
  await expect(other.get('not-the-owning-site', id)).rejects.toThrow()
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'finances', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  await expect(other.get('default', id)).rejects.toThrow()
  expect((await other.list('default')).docs).toHaveLength(0)
  await expect(other.process('default', id, {} as R2Bucket)).rejects.toThrow()
})

it('finds a stale late recipient during prevalidation before issuing the earlier valid recipients', async () => {
  const id = await create(),
    contacts = new ContactRepository(fixture.db, 1)
  await prepare(id)
  for (let index = 0; index < 3; index++)
    await prepare(
      id,
      String(
        (
          await contacts.create({
            site: 'default',
            operationKey: key(),
            profile: { kind: 'person', firstName: `Fictional late validation ${index}` },
            roles: ['contact'],
          })
        ).id,
      ),
    )
  const last = (await batches.get('default', id)).items.at(-1)!
  fixture.sqlite
    .prepare('UPDATE vc_crm_constituents SET revision=revision+1 WHERE id=?')
    .run(last.recipient.contact)
  await approve(id)
  await runBatch()
  expect((await batches.get('default', id)).job?.status).toBe('failed')
  expect(
    fixture.sqlite
      .prepare(
        'SELECT count(*) n FROM vc_crm_correspondence_recipients WHERE validated_revision IS NOT NULL',
      )
      .get()!.n,
  ).toBe(3)
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
})

it('restarts validation when a cancelled batch is retried and cannot use its old issuance cursor after a source edit', async () => {
  const id = await create()
  await prepare(id)
  await approve(id)
  const jobs = new CRMJobs(fixture.db),
    handler = correspondenceBatchJob(fixture.db)
  await jobs.tick({ correspondence: handler })
  await jobs.tick({ correspondence: handler })
  let page = await batches.get('default', id)
  expect(
    JSON.parse(
      String(
        fixture.sqlite.prepare('SELECT cursor FROM vc_crm_jobs WHERE id=?').get(page.job!.id)!
          .cursor,
      ),
    ).phase,
  ).toBe('issue')
  await batches.control({
    site: 'default',
    id,
    job: page.job!.id,
    expectedFence: page.job!.fence,
    action: 'cancel',
    operationKey: key(),
  })
  fixture.sqlite
    .prepare('UPDATE vc_crm_constituents SET revision=revision+1 WHERE id=?')
    .run(fixture.contact)
  page = await batches.get('default', id)
  await batches.control({
    site: 'default',
    id,
    job: page.job!.id,
    expectedFence: page.job!.fence,
    action: 'retry',
    operationKey: key(),
  })
  expect(
    fixture.sqlite.prepare('SELECT cursor FROM vc_crm_jobs WHERE id=?').get(page.job!.id)!.cursor,
  ).toBe('')
  await runBatch()
  expect((await batches.get('default', id)).job?.status).toBe('failed')
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
})

it('rolls document, audit, child PDF job and cursor back when a recipient changes after issuance preparation', async () => {
  const id = await create()
  await prepare(id)
  await approve(id)
  const jobs = new CRMJobs(fixture.db),
    handler = correspondenceBatchJob(fixture.db)
  await jobs.tick({ correspondence: handler })
  await jobs.tick({ correspondence: handler })
  const original = handler.prepare
  handler.prepare = async (job) => {
    const step = await original(job)
    fixture.sqlite
      .prepare('UPDATE vc_crm_constituents SET revision=revision+1 WHERE id=?')
      .run(fixture.contact)
    return step
  }
  await jobs.tick({ correspondence: handler })
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
  expect(
    fixture.sqlite
      .prepare("SELECT count(*) n FROM vc_platform_audit WHERE action='document.issued'")
      .get()!.n,
  ).toBe(0)
  expect(
    fixture.sqlite
      .prepare(
        "SELECT count(*) n FROM vc_crm_jobs WHERE json_extract(payload,'$.document') IS NOT NULL",
      )
      .get()!.n,
  ).toBe(0)
  expect((await batches.get('default', id)).totals.issued).toBe(0)
})

it('requires communications read access for private document previews even when edit remains granted', async () => {
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
  const documents = new CorrespondenceDocuments(fixture.db, 2),
    request = { site: 'default', contact: fixture.contact, ...values() }
  const reviewed = await documents.preview(request)
  await authority.setRestrictions({
    site: 'default',
    user: 2,
    denied: [{ category: 'communications', operation: 'read' }],
    expectedRevision: revision(),
    operationKey: key(),
  })
  expect(
    (await new OrganizationRepository(fixture.db, 2).authority('default', 'communications', 'edit'))
      .allowed,
  ).toBe(true)
  await expect(documents.preview(request)).rejects.toThrow()
  await expect(
    documents.issue({ ...request, approval: reviewed.approval, operationKey: key() }),
  ).rejects.toThrow()
  expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_documents').get()!.n).toBe(0)
})
