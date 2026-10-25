import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { MergeRequests } from '../../src/crm/merge-requests'
import { mergeSchemaV1 } from '../../src/crm/merge-schema-v1'
import { mergeProfileFields, type MergeProfileChoices } from '../../src/crm/merge-profile'
import { SiteConflictError } from '../../src/organizations/atomic'
import { SiteAccessError } from '../../src/organizations/repository'

async function setup() {
  const fixture = await crmTimelineFixture()
  for (const sql of mergeSchemaV1) fixture.sqlite.exec(sql)
  const contacts = new ContactRepository(fixture.db, 1)
  const duplicate = String(
    (
      await contacts.create({
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
        name: 'Fictional retained fund',
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  await finance.createGift({
    site: 'default',
    constituent: duplicate,
    amount: { currency: 'USD', minorUnits: '1000' },
    exponent: 2,
    kind: 'cash',
    receivedOn: '2026-10-25',
    allocations: [{ fund, currency: 'USD', minorUnits: '1000' }],
    operationKey: crypto.randomUUID(),
  })
  const input = {
    site: 'default',
    survivor: fixture.contact,
    duplicate,
    expectedProfiles: { survivor: 1, duplicate: 1 },
    operationKey: crypto.randomUUID(),
  }
  const choices = Object.fromEntries(
    mergeProfileFields.map((field) => [field, 'survivor']),
  ) as MergeProfileChoices
  return { ...fixture, contacts, input, choices, requests: new MergeRequests(fixture.db, 1) }
}

it('creates/reloads one owner-private request and queues one immutable review without changing donor records on retries', async () => {
  const fixture = await setup()
  try {
    const originals = fixture.sqlite.prepare('SELECT * FROM vc_crm_constituents ORDER BY id').all()
    const gifts = fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts ORDER BY id').all()
    const created = await fixture.requests.create(fixture.input)
    expect(await fixture.requests.create(fixture.input)).toEqual(created)
    await expect(
      new MergeRequests(fixture.db, 2).get('default', String(created.id)),
    ).rejects.toBeInstanceOf(SiteAccessError)
    const prepare = {
      site: 'default',
      id: String(created.id),
      expectedRevision: 1,
      expectedProfiles: fixture.input.expectedProfiles,
      profileChoices: fixture.choices,
      operationKey: crypto.randomUUID(),
    }
    const queued = await fixture.requests.prepare(prepare)
    expect(await fixture.requests.prepare(prepare)).toEqual(queued)
    const loaded = await new MergeRequests(fixture.db, 1).get('default', String(created.id))
    expect(loaded.row).toMatchObject({
      state: 'preparing',
      revision: 2,
      review_id: queued.review,
      job_id: queued.job,
    })
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_merge_reviews').get()).toEqual({
      n: 1,
    })
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_jobs').get()).toEqual({ n: 1 })
    const job = fixture.sqlite.prepare('SELECT kind,payload FROM vc_crm_jobs').get() as {
      kind: string
      payload: string
    }
    expect(job.kind).toBe('contact-merge')
    expect(JSON.parse(job.payload)).toEqual({
      v: 1,
      phase: 'prepare',
      merge: created.id,
      review: queued.review,
    })
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_constituents ORDER BY id').all()).toEqual(
      originals,
    )
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts ORDER BY id').all()).toEqual(gifts)
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_identity_aliases').get()).toEqual({
      n: 0,
    })
    await expect(
      fixture.requests.prepare({ ...prepare, operationKey: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(SiteConflictError)
  } finally {
    fixture.close()
  }
})

it('rejects stale profile decisions before creating review metadata or a job', async () => {
  const fixture = await setup()
  try {
    const created = await fixture.requests.create(fixture.input)
    await fixture.contacts.updateProfile({
      site: 'default',
      id: fixture.input.duplicate,
      expectedRevision: 1,
      confirmedSharedUpdate: true,
      profile: { kind: 'person', firstName: 'Changed before review' },
      operationKey: crypto.randomUUID(),
    })
    await expect(
      fixture.requests.prepare({
        site: 'default',
        id: String(created.id),
        expectedRevision: 1,
        expectedProfiles: fixture.input.expectedProfiles,
        profileChoices: fixture.choices,
        operationKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_merge_reviews').get()).toEqual({
      n: 0,
    })
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_jobs').get()).toEqual({ n: 0 })
  } finally {
    fixture.close()
  }
})

it('rolls back review, job, event and request changes together if the request is concurrently revised', async () => {
  const fixture = await setup()
  try {
    const created = await fixture.requests.create(fixture.input)
    fixture.sqlite.exec(
      'CREATE TRIGGER fixture_concurrent_merge_revision AFTER INSERT ON vc_crm_merge_reviews BEGIN UPDATE vc_crm_merges SET revision=revision+1 WHERE id=NEW.merge_id; END',
    )
    await expect(
      fixture.requests.prepare({
        site: 'default',
        id: String(created.id),
        expectedRevision: 1,
        expectedProfiles: fixture.input.expectedProfiles,
        profileChoices: fixture.choices,
        operationKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
    expect((await fixture.requests.get('default', String(created.id))).row).toMatchObject({
      state: 'draft',
      revision: 1,
      review_id: null,
      job_id: null,
    })
    for (const table of ['vc_crm_merge_reviews', 'vc_crm_jobs'])
      expect(fixture.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 })
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) n FROM vc_crm_merge_events WHERE kind='review-prepared'")
        .get(),
    ).toEqual({ n: 0 })
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) n FROM vc_platform_audit WHERE action='merge.review-prepared'")
        .get(),
    ).toEqual({ n: 0 })
  } finally {
    fixture.close()
  }
})

it('cancels preparation once, fences its worker and retains review history without donor writes', async () => {
  const fixture = await setup()
  try {
    const before = fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts ORDER BY id').all()
    const created = await fixture.requests.create(fixture.input)
    const prepared = await fixture.requests.prepare({
      site: 'default',
      id: String(created.id),
      expectedRevision: 1,
      expectedProfiles: fixture.input.expectedProfiles,
      profileChoices: fixture.choices,
      operationKey: crypto.randomUUID(),
    })
    fixture.sqlite
      .prepare(
        "UPDATE vc_crm_jobs SET status='running',fence=7,lease_until='2099-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(String(prepared.job))
    const input = {
      site: 'default',
      id: String(created.id),
      expectedRevision: 2,
      operationKey: crypto.randomUUID(),
    }
    const cancelled = await fixture.requests.cancel(input)
    expect(await fixture.requests.cancel(input)).toEqual(cancelled)
    expect((await fixture.requests.get('default', String(created.id))).row).toMatchObject({
      state: 'cancelled',
      revision: 3,
    })
    expect(
      fixture.sqlite
        .prepare('SELECT status,fence,lease_until FROM vc_crm_jobs WHERE id=?')
        .get(String(prepared.job)),
    ).toEqual({ status: 'cancelled', fence: 8, lease_until: null })
    const restarted = await fixture.requests.prepare({
      site: 'default',
      id: String(created.id),
      expectedRevision: 3,
      expectedProfiles: fixture.input.expectedProfiles,
      profileChoices: fixture.choices,
      operationKey: crypto.randomUUID(),
    })
    expect(restarted.review).not.toBe(prepared.review)
    expect(restarted.job).not.toBe(prepared.job)
    expect(
      fixture.sqlite
        .prepare('SELECT status,fence FROM vc_crm_jobs WHERE id=?')
        .get(String(prepared.job)),
    ).toEqual({ status: 'cancelled', fence: 8 })
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_merge_reviews').get()).toEqual({
      n: 2,
    })
    expect(
      fixture.sqlite
        .prepare("SELECT count(*) n FROM vc_crm_merge_events WHERE kind='cancelled'")
        .get(),
    ).toEqual({ n: 1 })
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts ORDER BY id').all()).toEqual(before)
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_identity_aliases').get()).toEqual({
      n: 0,
    })
  } finally {
    fixture.close()
  }
})
