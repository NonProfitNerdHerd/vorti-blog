import { expect, it } from 'vitest'
import { crmImportFixture } from '../helpers/crm-import-fixture'
import { ImportReferenceOptions } from '../../src/crm/import-reference-options'
import { OrganizationRepository } from '../../src/organizations/repository'
import { MembershipRepository } from '../../src/crm/memberships'

it('pages named references without hidden caps and rejects archived, cross-chapter, forged-field and revoked access', async () => {
  const fixture = await crmImportFixture(),
    id = crypto.randomUUID(),
    now = new Date().toISOString()
  try {
    fixture.sqlite
      .prepare("UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id='default'")
      .run()
    const authority = new OrganizationRepository(fixture.db, 1),
      child = await authority.createSite({
        parent: 'default',
        name: 'Separate chapter',
        expectedRevision: Number(
          fixture.sqlite.prepare("SELECT revision FROM vc_sites WHERE id='default'").get()!
            .revision,
        ),
        operationKey: crypto.randomUUID(),
      })
    fixture.sqlite
      .prepare(
        `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,created_at,updated_at)
      VALUES(?,'default',1,'Fund mapping','gifts','Legacy','gifts.csv','csv',1,?,?,?,?)`,
      )
      .run(id, 'a'.repeat(64), crypto.randomUUID(), now, now)
    for (let index = 0; index < 53; index++)
      fixture.sqlite
        .prepare(
          'INSERT INTO vc_crm_funds(id,site_id,name,created_at,updated_at) VALUES(?,?,?,?,?)',
        )
        .run(`choice-${String(index).padStart(3, '0')}`, 'default', `Choice ${index}`, now, now)
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_crm_funds(id,site_id,name,archived,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run('archived-choice', 'default', 'Hidden archived choice', 1, now, now)
    fixture.sqlite
      .prepare('INSERT INTO vc_crm_funds(id,site_id,name,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('other-choice', String(child.site), 'Other chapter choice', now, now)
    const options = new ImportReferenceOptions(fixture.db, 1),
      seen: string[] = []
    let after = ''
    do {
      const page = await options.list({ site: 'default', id, field: 'fund', after })
      seen.push(...page.docs.map((doc) => doc.id))
      after = page.next || ''
      expect(page.docs.every((doc) => Object.keys(doc).sort().join(',') === 'id,label')).toBe(true)
    } while (after)
    expect(seen).toHaveLength(53)
    expect(new Set(seen).size).toBe(53)
    expect(
      (await options.list({ site: 'default', id, field: 'fund', search: 'Choice 52' })).docs,
    ).toEqual([{ id: 'choice-052', label: 'Choice 52' }])
    expect((await options.list({ site: 'default', id, field: 'fund', search: '%' })).docs).toEqual(
      [],
    )
    await expect(
      options.list({ site: 'default', id, field: 'funds; DROP TABLE users' }),
    ).rejects.toThrow('linked import field')
    await expect(
      new ImportReferenceOptions(fixture.db, 2).list({ site: 'default', id, field: 'fund' }),
    ).rejects.toThrow()
    fixture.sqlite
      .prepare('INSERT INTO vc_account_status(user_id,disabled,updated_at) VALUES(1,1,?)')
      .run(now)
    await expect(options.list({ site: 'default', id, field: 'fund' })).rejects.toThrow()
  } finally {
    fixture.close()
  }
})

it('lists membership types and authorized prior terms, omitting terms whose covered contact was revoked', async () => {
  const fixture = await crmImportFixture(),
    id = crypto.randomUUID(),
    now = new Date().toISOString()
  try {
    const memberships = new MembershipRepository(fixture.db, 1),
      type = await memberships.saveType({
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
      }),
      term = await memberships.enroll({
        site: 'default',
        operationKey: crypto.randomUUID(),
        values: { type: type.id, typeRevision: 1, person: fixture.contact, startsOn: '2026-01-01' },
      })
    fixture.sqlite
      .prepare(
        `INSERT INTO vc_crm_import_runs(id,site_id,actor_id,name,domain,source_system,file_name,file_kind,file_size,file_sha256,file_key,created_at,updated_at)
      VALUES(?,'default',1,'Renewal mapping','memberships','Legacy','members.csv','csv',1,?,?,?,?)`,
      )
      .run(id, 'a'.repeat(64), crypto.randomUUID(), now, now)
    const options = new ImportReferenceOptions(fixture.db, 1)
    expect((await options.list({ site: 'default', id, field: 'type' })).docs).toEqual([
      { id: type.id, label: 'Annual membership' },
    ])
    const terms = await options.list({ site: 'default', id, field: 'renewedFrom' })
    expect(terms.docs).toHaveLength(1)
    expect(terms.docs[0].id).toBe(term.id)
    expect(terms.docs[0].label).toContain('Fictional timeline donor')
    fixture.sqlite
      .prepare('UPDATE vc_crm_affiliations SET archived=1 WHERE constituent_id=?')
      .run(fixture.contact)
    expect((await options.list({ site: 'default', id, field: 'renewedFrom' })).docs).toEqual([])
    expect(
      fixture.sqlite.prepare('SELECT count(*) AS n FROM vc_crm_membership_terms').get()!.n,
    ).toBe(1)
  } finally {
    fixture.close()
  }
})
