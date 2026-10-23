import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { contactSchemaV1 } from '../../src/crm/contact-schema-v1'
import { ContactRepository } from '../../src/crm/contacts'
import { OrganizationRepository, SiteAccessError } from '../../src/organizations/repository'
import { SiteConflictError } from '../../src/organizations/atomic'
import { validateContactProfile } from '../../src/crm/contact-model'

const person = (name = 'Fictional Alex') =>
  validateContactProfile({
    kind: 'person',
    firstName: name,
    lastName: 'Example',
    methods: [
      { kind: 'email', value: 'shared@example.invalid', label: 'Household', primary: true },
    ],
  })
describe('site-owned CRM contacts on local D1', () => {
  let proxy: PlatformProxy<{ D1: D1Database }>, db: D1Database, contacts: ContactRepository
  beforeAll(async () => {
    proxy = await getPlatformProxy<{ D1: D1Database }>({
      configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
      persist: false,
      remoteBindings: false,
    })
    db = proxy.env.D1
    await db
      .prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,attribution_label TEXT)')
      .run()
    await db
      .prepare(
        "INSERT INTO users(id,role) VALUES(1,'administrator'),(2,'editor'),(3,'editor'),(4,'editor')",
      )
      .run()
    for (const sql of [...organizationSchema, ...defaultOrganizationSeed, ...contactSchemaV1])
      await db.prepare(sql).run()
    contacts = new ContactRepository(db, 1)
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  it('requires valid names, preferences and unique methods while permitting absent/shared emails', () => {
    expect(() => validateContactProfile({ kind: 'person' })).toThrow('name')
    expect(() =>
      validateContactProfile({ kind: 'organization', organizationName: 'Fictional Partner' }),
    ).not.toThrow()
    expect(() =>
      validateContactProfile({ ...person(), communication: { emailAllowed: 'false' } }),
    ).toThrow('preference')
    expect(() =>
      validateContactProfile({ ...person(), methods: [...person().methods, ...person().methods] }),
    ).toThrow('duplicate')
    expect(validateContactProfile({ kind: 'person', firstName: 'No email' }).methods).toEqual([])
  })
  it('creates distinct shared-email identities and deduplicates operation retries', async () => {
    const input = {
      site: 'default',
      profile: person(),
      roles: ['donor', 'volunteer'],
      operationKey: 'contact_create_123456789',
    }
    const first = await contacts.create(input)
    expect(await contacts.create(input)).toEqual(first)
    const second = await contacts.create({
      ...input,
      profile: person('Fictional Pat'),
      operationKey: 'contact_create_other_123',
    })
    expect(first.id).not.toBe(second.id)
    const list = await contacts.list({ site: 'default', role: 'donor', limit: 1 })
    expect(list.total).toBe(2)
    expect(list.docs).toHaveLength(1)
    expect(list.next).not.toBeNull()
    const next = await contacts.list({
      site: 'default',
      role: 'donor',
      limit: 1,
      after: list.next!,
    })
    expect(next.docs[0].id).not.toBe(list.docs[0].id)
    expect(next.next).toBeNull()
  })
  it('requires explicit shared-profile confirmation and rejects stale overwrites', async () => {
    const contact = await contacts.create({
      site: 'default',
      profile: person('Before'),
      roles: ['contact'],
      operationKey: 'contact_update_seed_123',
    })
    const update = {
      site: 'default',
      id: contact.id as string,
      expectedRevision: 1,
      profile: person('After'),
      confirmedSharedUpdate: false,
      operationKey: 'contact_update_12345678',
    }
    await expect(contacts.updateProfile(update)).rejects.toThrow('Confirm')
    await contacts.updateProfile({ ...update, confirmedSharedUpdate: true })
    expect((await contacts.get('default', contact.id as string)).label).toBe('After Example')
    await expect(
      contacts.updateProfile({
        ...update,
        confirmedSharedUpdate: true,
        operationKey: 'contact_stale_123456789',
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
  })
  it('isolates unrelated organizations and rejects forged cross-root affiliations', async () => {
    const organization = await new OrganizationRepository(db, 1).createOrganization({
      name: 'Fictional Other Network',
      siteName: 'Other',
      operationKey: 'contact_other_network_123',
    })
    const contact = await contacts.create({
      site: organization.site as string,
      profile: person('Private Other'),
      roles: ['donor'],
      operationKey: 'contact_other_private_123',
    })
    await expect(
      new ContactRepository(db, 2).get(organization.site as string, contact.id as string),
    ).rejects.toBeInstanceOf(SiteAccessError)
    expect((await contacts.list({ site: 'default', search: 'Private Other' })).total).toBe(0)
    await expect(
      db
        .prepare(
          "INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,created_at,updated_at) VALUES('forged','default','default',?,'now','now')",
        )
        .bind(contact.id)
        .run(),
    ).rejects.toThrow('Invalid chapter relationship')
  })
  it('lets read-only contacts request a correction without changing the shared profile', async () => {
    const contact = await contacts.create({
      site: 'default',
      profile: person('Correction'),
      roles: ['contact'],
      operationKey: 'contact_correction_seed_123',
    })
    const reader = new ContactRepository(db, 2)
    expect((await reader.get('default', contact.id as string)).canEditProfile).toBe(false)
    await expect(
      reader.updateProfile({
        site: 'default',
        id: contact.id as string,
        expectedRevision: 1,
        profile: person('Forbidden'),
        confirmedSharedUpdate: true,
        operationKey: 'contact_forbidden_123456',
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    await reader.requestCorrection({
      site: 'default',
      id: contact.id as string,
      message: 'Please verify the mailing address.',
      operationKey: 'contact_correction_12345',
    })
    expect((await contacts.get('default', contact.id as string)).revision).toBe(1)
    expect(
      (
        await db
          .prepare('SELECT count(*) AS n FROM vc_crm_corrections WHERE constituent_id=?')
          .bind(contact.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1)
    const requests = await reader.corrections({ site: 'default', id: contact.id as string })
    expect(requests.canResolve).toBe(false)
    expect(requests.total).toBe(1)
    await expect(
      reader.resolveCorrection({
        site: 'default',
        id: contact.id as string,
        correction: requests.docs[0].id,
        expectedRevision: 1,
        status: 'resolved',
        reason: 'Not allowed',
        operationKey: 'correction_forbidden_review_123',
      }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    const review = {
      site: 'default',
      id: contact.id as string,
      correction: requests.docs[0].id,
      expectedRevision: 1,
      status: 'resolved' as const,
      reason: 'Verified with fictional source record.',
      operationKey: 'correction_admin_review_123',
    }
    const resolved = await contacts.resolveCorrection(review)
    expect(await contacts.resolveCorrection(review)).toEqual(resolved)
    expect(
      (await contacts.corrections({ site: 'default', id: contact.id as string })).docs[0].status,
    ).toBe('resolved')
    expect((await contacts.get('default', contact.id as string)).revision).toBe(1)
  })
  it('rejects a read if membership is revoked after authorization but before delivery', async () => {
    const contact = await contacts.create({
      site: 'default',
      profile: person('Revocation fixture'),
      roles: ['contact'],
      operationKey: 'contact_revocation_fixture_123',
    })
    let intercepted = false
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property) {
          if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values))
          if (property === 'first')
            return async () => {
              if (!intercepted) {
                intercepted = true
                await db
                  .prepare(
                    "UPDATE vc_site_memberships SET active=0 WHERE site_id='default' AND user_id=4",
                  )
                  .run()
              }
              return target.first()
            }
          const value = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    const racing = {
      prepare: (query: string) =>
        query.includes('a.id AS affiliation_id') ? wrap(db.prepare(query)) : db.prepare(query),
    } as unknown as D1Database
    await expect(
      new ContactRepository(racing, 4).get('default', contact.id as string),
    ).rejects.toBeInstanceOf(SiteAccessError)
    expect(intercepted).toBe(true)
  })
  it('keeps chapter roles and tags separate from shared identity and another chapter', async () => {
    const contact = await contacts.create({
      site: 'default',
      profile: person('Shared Chapters'),
      roles: ['donor'],
      tags: ['Original chapter'],
      operationKey: 'contact_chapters_seed_123',
    })
    await db.prepare("UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id='default'").run()
    const child = await new OrganizationRepository(db, 1).createSite({
      parent: 'default',
      name: 'Fictional Local Chapter',
      expectedRevision: 1,
      operationKey: 'contact_chapter_create_123',
    })
    await db
      .prepare("INSERT INTO vc_site_memberships(site_id,user_id,role) VALUES(?,3,'editor')")
      .bind(child.site)
      .run()
    await db
      .prepare(
        "INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,roles,created_at,updated_at) VALUES('fixture-shared-chapter','default',?,?, '[\"volunteer\"]','now','now')",
      )
      .bind(child.site, contact.id)
      .run()
    const local = new ContactRepository(db, 3)
    const localContact = await local.get(child.site as string, contact.id as string)
    expect(localContact.canEditChapter).toBe(true)
    expect(localContact.canEditProfile).toBe(false)
    await local.updateChapter({
      site: child.site as string,
      id: contact.id as string,
      expectedRevision: 1,
      roles: ['volunteer', 'member'],
      tags: ['Woodworking', 'woodworking'],
      operationKey: 'contact_chapter_update_123',
    })
    const updated = await local.get(child.site as string, contact.id as string)
    expect(updated.roles).toEqual(['volunteer', 'member'])
    expect(updated.tags).toHaveLength(1)
    expect(updated.revision).toBe(1)
    const original = await contacts.get('default', contact.id as string)
    expect(original.roles).toEqual(['donor'])
    expect(original.tags).toEqual(['Original chapter'])
    await expect(
      local.updateChapter({
        site: child.site as string,
        id: contact.id as string,
        expectedRevision: 1,
        roles: ['donor'],
        tags: [],
        operationKey: 'contact_chapter_stale_123',
      }),
    ).rejects.toBeInstanceOf(SiteConflictError)
  })
})
