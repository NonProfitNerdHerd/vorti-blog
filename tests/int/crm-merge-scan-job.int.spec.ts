import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactRepository } from '../../src/crm/contacts'
import { MergeRequests } from '../../src/crm/merge-requests'
import { mergeSchemaV1 } from '../../src/crm/merge-schema-v1'
import { mergeProfileFields, type MergeProfileChoices } from '../../src/crm/merge-profile'
import { mergeScanJob } from '../../src/crm/merge-scan-job'
import { CRMJobs, type CRMJob } from '../../src/crm/jobs'
import { MergeAccess } from '../../src/crm/merge-access'

async function setup() {
  const fixture = await crmTimelineFixture()
  for (const sql of mergeSchemaV1) fixture.sqlite.exec(sql)
  const duplicate = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional scan duplicate' },
        roles: ['donor'],
        operationKey: crypto.randomUUID(),
      })
    ).id,
  )
  const requests = new MergeRequests(fixture.db, 1)
  const created = await requests.create({
    site: 'default',
    survivor: fixture.contact,
    duplicate,
    expectedProfiles: { survivor: 1, duplicate: 1 },
    operationKey: crypto.randomUUID(),
  })
  const queued = await requests.prepare({
    site: 'default',
    id: String(created.id),
    expectedRevision: 1,
    expectedProfiles: { survivor: 1, duplicate: 1 },
    profileChoices: Object.fromEntries(
      mergeProfileFields.map((field) => [field, 'survivor']),
    ) as MergeProfileChoices,
    operationKey: crypto.randomUUID(),
  })
  return {
    ...fixture,
    duplicate,
    requests,
    merge: String(created.id),
    queued,
    job: () =>
      fixture.sqlite
        .prepare('SELECT * FROM vc_crm_jobs WHERE id=?')
        .get(String(queued.job)) as unknown as CRMJob,
  }
}

it('checkpoints private snapshots through the fenced runner without publishing or enabling approval', async () => {
  const fixture = await setup()
  try {
    const before = fixture.sqlite.prepare('SELECT * FROM vc_crm_constituents ORDER BY id').all()
    const runner = new CRMJobs(fixture.db)
    expect(await runner.tick({ 'contact-merge': mergeScanJob(fixture.db) }, fixture.job().id)).toBe(
      true,
    )
    expect(fixture.job().status).toBe('pending')
    expect(fixture.job().progress).toBe(2)
    expect(JSON.parse(fixture.job().cursor)).toEqual({ kind: 1 })
    const items = fixture.sqlite.prepare('SELECT * FROM vc_crm_merge_items').all()
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.parse(String(item.snapshot)).mergeSite).toBe('default')
    }
    expect(fixture.sqlite.prepare('SELECT state FROM vc_crm_merges').get()).toEqual({
      state: 'preparing',
    })
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_merge_seals').get()).toEqual({
      n: 0,
    })
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_constituents ORDER BY id').all()).toEqual(
      before,
    )
  } finally {
    fixture.close()
  }
})

it('rolls back a prepared checkpoint if cancellation wins before its transaction', async () => {
  const fixture = await setup()
  try {
    const step = await mergeScanJob(fixture.db).prepare(fixture.job())
    await fixture.requests.cancel({
      site: 'default',
      id: fixture.merge,
      expectedRevision: 2,
      operationKey: crypto.randomUUID(),
    })
    await expect(fixture.db.batch(step.writes)).rejects.toThrow()
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_merge_items').get()).toEqual({
      n: 0,
    })
    expect(fixture.job().status).toBe('cancelled')
  } finally {
    fixture.close()
  }
})

it('rejects a changed profile before staging and rolls back changes after preparation', async () => {
  const fixture = await setup()
  try {
    const handler = mergeScanJob(fixture.db)
    const step = await handler.prepare(fixture.job())
    fixture.sqlite
      .prepare('UPDATE vc_crm_constituents SET revision=revision+1 WHERE id=?')
      .run(fixture.duplicate)
    await expect(fixture.db.batch(step.writes)).rejects.toThrow()
    await expect(handler.prepare(fixture.job())).rejects.toThrow(
      'Reviewed records or permissions changed',
    )
    expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_merge_items').get()).toEqual({
      n: 0,
    })
  } finally {
    fixture.close()
  }
})

it('inventories every private attachment page and its retained events without changing content ownership', async () => {
  const fixture = await setup()
  try {
    const now = new Date().toISOString()
    for (let index = 0; index < 28; index++) {
      const id = `fictional-file-${String(index).padStart(3, '0')}`
      fixture.sqlite
        .prepare(
          `INSERT INTO vc_crm_attachments
        (id,site_id,record_type,record_id,category,filename,mime,bytes,sha256,object_key,created_by,created_at,updated_at)
        VALUES(?,'default','contact',?,'communications','Fictional private file','text/plain',10,?,?,1,?,?)`,
        )
        .run(id, fixture.duplicate, 'a'.repeat(64), id, now, now)
      fixture.sqlite
        .prepare(
          `INSERT INTO vc_crm_attachment_events(id,attachment_id,action,actor_id,operation_key,created_at) VALUES(?,?,'staged',1,?,?)`,
        )
        .run(id + '-event', id, id + '-operation', now)
    }
    const originals = fixture.sqlite.prepare('SELECT * FROM vc_crm_attachments ORDER BY id').all()
    const access = new MergeAccess(fixture.db, 1)
    const input = { site: 'default', survivor: fixture.contact, duplicate: fixture.duplicate }
    const first = await access.inventoryPage({ ...input, kind: 'attachments' })
    expect(first.docs).toHaveLength(25)
    expect(first.next).toBeTruthy()
    const last = await access.inventoryPage({ ...input, kind: 'attachments', after: first.next! })
    expect(last.docs).toHaveLength(3)
    expect(last.next).toBeNull()
    const events = await access.inventoryPage({ ...input, kind: 'attachment-events' })
    expect(events.docs).toHaveLength(25)
    expect(events.docs[0].attachment_id).toBe('fictional-file-000')
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_attachments ORDER BY id').all()).toEqual(
      originals,
    )
  } finally {
    fixture.close()
  }
})

it('includes prior aliases in later inventories and requires selecting their current identity', async () => {
  const fixture = await setup()
  try {
    // Install a previously published lineage using the real schema guards. This
    // tests inventory resolution, not the still-unavailable application service.
    const epoch = (
      fixture.sqlite.prepare('SELECT authority_revision FROM vc_organizations').get() as {
        authority_revision: number
      }
    ).authority_revision
    const root = (
      fixture.sqlite.prepare('SELECT organization_id FROM vc_sites WHERE id=?').get('default') as {
        organization_id: string
      }
    ).organization_id
    const now = new Date().toISOString()
    fixture.sqlite.prepare("UPDATE vc_crm_merges SET state='ready' WHERE id=?").run(fixture.merge)
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_merge_seals(review_id,manifest_hash,item_count,authority_revision,created_at) VALUES(?,?,0,?,?)',
      )
      .run(String(fixture.queued.review), 'b'.repeat(64), epoch, now)
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_merge_approvals(review_id,actor_id,authority_revision,manifest_hash,created_at) VALUES(?,1,?,?,?)',
      )
      .run(String(fixture.queued.review), epoch, 'b'.repeat(64), now)
    fixture.sqlite
      .prepare("UPDATE vc_crm_merges SET state='applying' WHERE id=?")
      .run(fixture.merge)
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_identity_aliases(identity_id,organization_id,canonical_id,merge_id) VALUES(?,?,?,?)',
      )
      .run(fixture.duplicate, root, fixture.contact, fixture.merge)
    fixture.sqlite
      .prepare("UPDATE vc_crm_merges SET state='completed' WHERE id=?")
      .run(fixture.merge)
    const third = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: { kind: 'person', firstName: 'Fictional later duplicate' },
          roles: ['donor'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    const access = new MergeAccess(fixture.db, 1)
    const page = await access.inventoryPage({
      site: 'default',
      survivor: fixture.contact,
      duplicate: third,
      kind: 'affiliations',
    })
    expect(page.docs).toHaveLength(3)
    expect(page.docs.map((row) => row.constituent_id)).toContain(fixture.duplicate)
    await expect(
      access.pair({ site: 'default', survivor: fixture.duplicate, duplicate: third }),
    ).rejects.toThrow('current constituent identities')
  } finally {
    fixture.close()
  }
})

it('rejects chapter profile edits and authority changes between preparation and checkpoint', async () => {
  for (const mutation of ['affiliation', 'authority'] as const) {
    const fixture = await setup()
    try {
      const step = await mergeScanJob(fixture.db).prepare(fixture.job())
      if (mutation === 'affiliation')
        fixture.sqlite
          .prepare('UPDATE vc_crm_affiliations SET revision=revision+1 WHERE constituent_id=?')
          .run(fixture.duplicate)
      else
        fixture.sqlite.exec('UPDATE vc_organizations SET authority_revision=authority_revision+1')
      await expect(fixture.db.batch(step.writes)).rejects.toThrow()
      await expect(mergeScanJob(fixture.db).prepare(fixture.job())).rejects.toThrow()
      expect(fixture.sqlite.prepare('SELECT count(*) n FROM vc_crm_merge_items').get()).toEqual({
        n: 0,
      })
    } finally {
      fixture.close()
    }
  }
})
