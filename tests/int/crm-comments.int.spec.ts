import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { CommentRepository } from '../../src/crm/comments'
import { ContactTimeline } from '../../src/crm/timeline'

it('keeps constituent comments in the selected chapter and records author edits in Activity', async () => {
  const fixture = await crmTimelineFixture()
  try {
    const comments = new CommentRepository(fixture.db, 1, 'Fictional operator')
    const created = await comments.save({ site: 'default', contact: fixture.contact, body: 'First comment', operationKey: crypto.randomUUID() })
    fixture.sqlite.exec(`INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at)
      VALUES('child','default','default','Child chapter','child','2026-10-28T00:00:00.000Z','2026-10-28T00:00:00.000Z');
      INSERT INTO vc_site_ancestry(ancestor_id,descendant_id,distance) VALUES('default','child',1),('child','child',0);
      INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,roles,tags,created_at,updated_at)
      VALUES('child-affiliation','default','child','${fixture.contact}','["donor"]','[]','2026-10-28T00:00:00.000Z','2026-10-28T00:00:00.000Z')`)
    expect((await comments.list('child', fixture.contact)).docs).toEqual([])
    const initial = await comments.list('default', fixture.contact)
    expect(initial.docs).toMatchObject([{ id: created.id, body: 'First comment', author_label: 'Fictional operator', canEdit: true }])
    expect(initial.docs[0].revision).toBe(1)
    await comments.save({ site: 'default', contact: fixture.contact, id: String(created.id), expectedRevision: 1,
      body: 'Updated comment', operationKey: crypto.randomUUID() })
    await expect(comments.save({ site: 'default', contact: fixture.contact, id: String(created.id), expectedRevision: 1,
      body: 'Stale edit', operationKey: crypto.randomUUID() })).rejects.toThrow()
    expect((await comments.list('default', fixture.contact)).docs[0]).toMatchObject({ body: 'Updated comment', revision: 2 })
    fixture.sqlite.exec("INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES('default',2,'communications','edit')")
    const reader = new CommentRepository(fixture.db, 2, 'Fictional reader')
    expect(await reader.list('default', fixture.contact)).toMatchObject({ canPost: false, docs: [{ canEdit: false }] })
    await expect(reader.save({ site: 'default', contact: fixture.contact, body: 'Reader post', operationKey: crypto.randomUUID() })).rejects.toThrow()
    await expect(reader.save({ site: 'default', contact: fixture.contact, id: String(created.id), expectedRevision: 2,
      body: 'Reader edit', operationKey: crypto.randomUUID() })).rejects.toThrow()
    fixture.sqlite.exec("DELETE FROM vc_member_restrictions WHERE site_id='default' AND user_id=2 AND category='communications' AND operation='edit'")
    await expect(reader.save({ site: 'default', contact: fixture.contact, id: String(created.id), expectedRevision: 2,
      body: 'Another author edit', operationKey: crypto.randomUUID() })).rejects.toThrow()
    const activity = await new ContactTimeline(fixture.db, 1).list({ site: 'default', contact: fixture.contact, group: 'comments' })
    expect(activity.docs.map(row => row.title)).toEqual(['Comment edited', 'Comment added'])
    await expect(comments.list('missing', fixture.contact)).rejects.toThrow()
  } finally { fixture.close() }
})
