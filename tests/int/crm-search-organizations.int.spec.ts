import { afterEach, beforeEach, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { organizationContactsSchemaV1 } from '../../src/crm/organization-contacts-schema-v1'
import { ContactRepository } from '../../src/crm/contacts'
import { crmSearchEndpoints } from '../../src/crm/search-endpoints'
import { organizationContactEndpoints } from '../../src/crm/organization-contact-endpoints'
import { errorResponse } from '../../src/crm/plugin'
import { OrganizationRepository } from '../../src/organizations/repository'

let fixture: Awaited<ReturnType<typeof crmTimelineFixture>>
const key = () => crypto.randomUUID()
beforeEach(async () => {
  fixture = await crmTimelineFixture()
  for (const statement of organizationContactsSchemaV1) fixture.sqlite.exec(statement)
})
afterEach(() => fixture.close())
const request = (path: string, actor = 1, body?: unknown) => {
  const input = new Request(`https://example.test/api${path}`, body ? {
    method: 'POST', headers: { origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined)
  return { user: { id: actor, collection: 'users' }, url: input.url, headers: input.headers, body: input.body } as PayloadRequest
}
it('separates people and organizations and limits search to the selected site', async () => {
  const repo = new ContactRepository(fixture.db, 1)
  const organization = String((await repo.create({ site: 'default', profile: { kind: 'organization', organizationName: 'Fictional Alliance' }, roles: ['donor'], operationKey: key() })).id)
  expect((await repo.list({ site: 'default', kind: 'person' })).docs.some(doc => doc.id === organization)).toBe(false)
  expect((await repo.list({ site: 'default', kind: 'organization' })).docs.map(doc => doc.id)).toContain(organization)
  const search = crmSearchEndpoints(fixture.db, errorResponse)[0]
  const found = await search.handler(request('/crm/search?site=default&q=Fictional&section=organizations'))
  expect(found.status).toBe(200)
  expect((await found.json() as { docs: Array<{ id: string }> }).docs.map(doc => doc.id)).toContain(organization)
  const all = await search.handler(request('/crm/search?site=default&q=Fictional'))
  expect(all.status).toBe(200)
  const foreign = await search.handler(request('/crm/search?site=missing-site&q=Fictional'))
  expect(foreign.status).toBe(403)
})
it('limits grouped suggestions and paginates full results', async () => {
  const repo = new ContactRepository(fixture.db, 1)
  for (let index = 0; index < 28; index++)
    await repo.create({ site: 'default', profile: { kind: 'organization', organizationName: `Fictional Batch ${String(index).padStart(2, '0')}` }, roles: ['donor'], operationKey: key() })
  const search = crmSearchEndpoints(fixture.db, errorResponse)[0]
  const suggestions = await search.handler(request('/crm/search?site=default&q=Fictional%20Batch&mode=suggest&section=organizations'))
  expect(suggestions.status).toBe(200)
  expect((await suggestions.json() as { docs: unknown[] }).docs).toHaveLength(3)
  const first = await search.handler(request('/crm/search?site=default&q=Fictional%20Batch&section=organizations&page=1'))
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ total: 28, page: 1, docs: expect.arrayContaining([expect.objectContaining({ subtype: 'organization' })]) })
  const second = await search.handler(request('/crm/search?site=default&q=Fictional%20Batch&section=organizations&page=2'))
  expect(second.status).toBe(200)
  expect((await second.json() as { docs: unknown[] }).docs).toHaveLength(3)
})
it('links contact people, replaces a primary atomically, and rejects cross-site people', async () => {
  const contacts = new ContactRepository(fixture.db, 1)
  const organization = String((await contacts.create({ site: 'default', profile: { kind: 'organization', organizationName: 'Fictional Giving Group' }, roles: ['donor'], operationKey: key() })).id)
  const second = String((await contacts.create({ site: 'default', profile: { kind: 'person', firstName: 'Fictional second contact' }, roles: ['contact'], operationKey: key() })).id)
  const endpoint = organizationContactEndpoints(fixture.db, errorResponse)
  const post = endpoint.find(value => value.method === 'post')!
  const get = endpoint.find(value => value.method === 'get')!
  for (const person of [fixture.contact, second]) {
    const result = await post.handler(request('/crm/organization-contacts', 1, {
      site: 'default', organization, person, role: 'Coordinator', startsOn: '2026-10-30', primary: true, operationKey: key(),
    }))
    expect(result.status).toBe(200)
  }
  const data = await get.handler(request(`/crm/organization-contacts?site=default&contact=${organization}`))
  expect(data.status).toBe(200)
  const links = (await data.json() as { docs: Array<{ person_id: string; primary_contact: number }> }).docs
  expect(links).toHaveLength(2)
  expect(links.filter(link => link.primary_contact === 1).map(link => link.person_id)).toEqual([second])
  fixture.sqlite.exec("UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id='default'")
  const authority = new OrganizationRepository(fixture.db, 1)
  const chapter = String((await authority.createSite({ parent: 'default', name: 'Fictional other chapter',
    expectedRevision: Number(fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision), operationKey: key() })).site)
  const foreign = String((await contacts.create({ site: chapter, profile: { kind: 'person', firstName: 'Chapter only' }, roles: ['contact'], operationKey: key() })).id)
  const rejected = await post.handler(request('/crm/organization-contacts', 1, {
    site: 'default', organization, person: foreign, startsOn: '2026-10-30', operationKey: key(),
  }))
  expect(rejected.status).not.toBe(200)
})
it('searches volunteer records only when their separate read permissions allow them', async () => {
  const contact = fixture.contact
  const activity = key(), invitation = key(), participation = key(), hours = key()
  fixture.sqlite.prepare(`INSERT INTO vc_crm_volunteer_profiles(site_id,constituent_id,skills,interests,availability) VALUES(?,?,?,?,?)`)
    .run('default', contact, '["Food outreach"]', '[]', 'Weekends')
  fixture.sqlite.prepare(`INSERT INTO vc_crm_volunteer_activities(id,site_id,name,starts_on,ends_on) VALUES(?,?,?,?,?)`)
    .run(activity, 'default', 'Fictional food outreach', '2026-10-30', '2026-10-30')
  fixture.sqlite.prepare(`INSERT INTO vc_crm_volunteer_invitations(id,activity_id,constituent_id,channel,occurred_on,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(invitation, activity, contact, 'email', '2026-10-29', 1, '2026-10-29T10:00:00Z')
  fixture.sqlite.prepare(`INSERT INTO vc_crm_volunteer_participation(id,activity_id,constituent_id,state) VALUES(?,?,?,?)`)
    .run(participation, activity, contact, 'attended')
  fixture.sqlite.prepare(`INSERT INTO vc_crm_volunteer_hours(id,activity_id,constituent_id,occurred_on,minutes,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(hours, activity, contact, '2026-10-30', 90, 1, '2026-10-30T10:00:00Z')
  const endpoint = crmSearchEndpoints(fixture.db, errorResponse)[0]
  const full = await endpoint.handler(request('/crm/search?site=default&q=Fictional&section=volunteers'))
  expect(full.status).toBe(200)
  expect(new Set((await full.json() as { docs: Array<{ subtype: string }> }).docs.map(doc => doc.subtype)))
    .toEqual(new Set(['profile', 'activity', 'invitation', 'hours']))
  const authority = new OrganizationRepository(fixture.db, 1)
  const revision = () => Number(fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!.revision)
  await authority.setMembership({ site: 'default', user: 2, role: 'reader', active: true, expectedRevision: revision(), operationKey: key() })
  await authority.setRestrictions({ site: 'default', user: 2, denied: [{ category: 'volunteer-hours', operation: 'read' }],
    expectedRevision: revision(), operationKey: key() })
  const limited = await endpoint.handler(request('/crm/search?site=default&q=Fictional&section=volunteers', 2))
  expect(limited.status).toBe(200)
  expect((await limited.json() as { docs: Array<{ subtype: string }> }).docs.some(doc => doc.subtype === 'hours')).toBe(false)
})
