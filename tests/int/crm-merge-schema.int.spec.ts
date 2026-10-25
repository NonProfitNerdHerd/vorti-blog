import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactRepository } from '../../src/crm/contacts'
import { mergeSchemaV1 } from '../../src/crm/merge-schema-v1'

async function setup() {
  const fixture = await crmTimelineFixture()
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
  const root = (await fixture.db
    .prepare('SELECT organization_id FROM vc_sites WHERE id=?')
    .bind('default')
    .first<{ organization_id: string }>())!.organization_id
  const original = fixture.sqlite.prepare('SELECT * FROM vc_crm_constituents ORDER BY id').all()
  for (const sql of mergeSchemaV1) fixture.sqlite.exec(sql)
  const now = '2026-10-25T00:00:00.000Z'
  fixture.sqlite
    .prepare(
      'INSERT INTO vc_crm_merges(id,organization_id,site_id,actor_id,survivor_id,duplicate_id,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?)',
    )
    .run('merge-1', root, 'default', fixture.contact, duplicate, now, now)
  return { ...fixture, duplicate, root, original, now }
}

async function approve(fixture: Awaited<ReturnType<typeof setup>>, merge: string) {
  const epoch = (await fixture.db
    .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
    .bind(fixture.root)
    .first<{ authority_revision: number }>())!.authority_revision
  const review = `review-${merge}`
  fixture.sqlite
    .prepare(
      'INSERT INTO vc_crm_merge_reviews(id,merge_id,request_revision,authority_revision,survivor_revision,duplicate_revision,survivor_snapshot,duplicate_snapshot,decisions_json,created_at) VALUES(?,?,1,?,1,1,?,?,?,?)',
    )
    .run(review, merge, epoch, '{}', '{}', '{}', fixture.now)
  fixture.sqlite
    .prepare(
      'INSERT INTO vc_crm_merge_seals(review_id,manifest_hash,item_count,authority_revision,created_at) VALUES(?,?,0,?,?)',
    )
    .run(review, 'a'.repeat(64), epoch, fixture.now)
  fixture.sqlite
    .prepare('UPDATE vc_crm_merges SET review_id=?,state=? WHERE id=?')
    .run(review, 'ready', merge)
  fixture.sqlite
    .prepare(
      'INSERT INTO vc_crm_merge_approvals(review_id,actor_id,authority_revision,manifest_hash,created_at) VALUES(?,1,?,?,?)',
    )
    .run(review, epoch, 'a'.repeat(64), fixture.now)
  fixture.sqlite.prepare('UPDATE vc_crm_merges SET state=? WHERE id=?').run('applying', merge)
}

it('upgrades additively and repeatedly without changing original identities or existing schema records', async () => {
  const fixture = await setup()
  try {
    const before = fixture.sqlite.prepare('SELECT * FROM vc_crm_affiliations ORDER BY id').all()
    for (const sql of mergeSchemaV1) fixture.sqlite.exec(sql)
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_constituents ORDER BY id').all()).toEqual(
      fixture.original,
    )
    expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_affiliations ORDER BY id').all()).toEqual(
      before,
    )
    expect(() =>
      fixture.sqlite.prepare('DELETE FROM vc_crm_merges WHERE id=?').run('merge-1'),
    ).toThrow(/retained/)
    expect(() =>
      fixture.sqlite
        .prepare('UPDATE vc_crm_merges SET survivor_id=? WHERE id=?')
        .run(fixture.duplicate, 'merge-1'),
    ).toThrow(/retained/)
  } finally {
    fixture.close()
  }
})

it('seals immutable snapshots and rejects changed or stale approval manifests', async () => {
  const fixture = await setup()
  try {
    const epoch = (await fixture.db
      .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
      .bind(fixture.root)
      .first<{ authority_revision: number }>())!.authority_revision
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_merge_reviews(id,merge_id,request_revision,authority_revision,survivor_revision,duplicate_revision,survivor_snapshot,duplicate_snapshot,decisions_json,created_at) VALUES(?,?,1,?,1,1,?,?,?,?)',
      )
      .run('review-1', 'merge-1', epoch, '{}', '{}', '{}', fixture.now)
    fixture.sqlite
      .prepare('UPDATE vc_crm_merges SET review_id=?,state=? WHERE id=?')
      .run('review-1', 'ready', 'merge-1')
    const item = fixture.sqlite.prepare(
      'INSERT INTO vc_crm_merge_items(review_id,kind,cursor_key,site_id,record_id,fingerprint,snapshot) VALUES(?,?,?,?,?,?,?)',
    )
    item.run('review-1', 'affiliations', 'a', 'default', 'a', 'a'.repeat(64), '{}')
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_merge_seals(review_id,manifest_hash,item_count,authority_revision,created_at) VALUES(?,?,1,?,?)',
      )
      .run('review-1', 'b'.repeat(64), epoch, fixture.now)
    expect(() => item.run('review-1', 'gifts', 'b', 'default', 'b', 'a'.repeat(64), '{}')).toThrow(
      /immutable/,
    )
    expect(() =>
      fixture.sqlite
        .prepare('UPDATE vc_crm_merge_reviews SET decisions_json=? WHERE id=?')
        .run('{"changed":true}', 'review-1'),
    ).toThrow(/append-only/)
    const approve = fixture.sqlite.prepare(
      'INSERT INTO vc_crm_merge_approvals(review_id,actor_id,authority_revision,manifest_hash,created_at) VALUES(?,1,?,?,?)',
    )
    expect(() => approve.run('review-1', epoch, 'c'.repeat(64), fixture.now)).toThrow(
      /sealed review/,
    )
    fixture.sqlite
      .prepare('UPDATE vc_organizations SET authority_revision=authority_revision+1 WHERE id=?')
      .run(fixture.root)
    expect(() => approve.run('review-1', epoch, 'b'.repeat(64), fixture.now)).toThrow(
      /sealed review/,
    )
  } finally {
    fixture.close()
  }
})

it('keeps subsequent identity resolution direct and rejects cycles without rewriting original profiles', async () => {
  const fixture = await setup()
  try {
    const insert = fixture.sqlite.prepare(
      'INSERT INTO vc_crm_identity_aliases(identity_id,organization_id,canonical_id,merge_id) VALUES(?,?,?,?)',
    )
    expect(() => insert.run(fixture.duplicate, fixture.root, fixture.contact, 'merge-1')).toThrow()
    await approve(fixture, 'merge-1')
    insert.run(fixture.duplicate, fixture.root, fixture.contact, 'merge-1')
    expect(() => insert.run(fixture.contact, fixture.root, fixture.duplicate, 'merge-1')).toThrow(
      /resolve directly/,
    )
    const third = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: 'default',
          profile: { kind: 'person', firstName: 'Fictional later survivor' },
          roles: ['contact'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_merges(id,organization_id,site_id,actor_id,survivor_id,duplicate_id,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?)',
      )
      .run('merge-2', fixture.root, 'default', third, fixture.contact, fixture.now, fixture.now)
    await approve(fixture, 'merge-2')
    fixture.sqlite.exec('BEGIN')
    fixture.sqlite
      .prepare(
        'UPDATE vc_crm_identity_aliases SET canonical_id=?,merge_id=?,revision=revision+1 WHERE canonical_id=?',
      )
      .run(third, 'merge-2', fixture.contact)
    insert.run(fixture.contact, fixture.root, third, 'merge-2')
    fixture.sqlite.exec('COMMIT')
    expect(
      fixture.sqlite.prepare('SELECT DISTINCT canonical_id FROM vc_crm_identity_aliases').all(),
    ).toEqual([{ canonical_id: third }])
    expect(
      fixture.sqlite
        .prepare('SELECT * FROM vc_crm_constituents WHERE id<>? ORDER BY id')
        .all(third),
    ).toEqual(fixture.original)
    expect(() =>
      fixture.sqlite
        .prepare('DELETE FROM vc_crm_identity_aliases WHERE identity_id=?')
        .run(fixture.duplicate),
    ).toThrow(/retained/)
  } finally {
    fixture.close()
  }
})
