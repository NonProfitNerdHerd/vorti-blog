import { expect, it } from 'vitest'
import { crmTimelineFixture } from '../helpers/crm-timeline-fixture'
import { ContactRepository } from '../../src/crm/contacts'
import { FinanceRepository } from '../../src/crm/finance'
import { OrganizationRepository, SiteAccessError } from '../../src/organizations/repository'
import { MergeAccess } from '../../src/crm/merge-access'
import { mergeSchemaV1 } from '../../src/crm/merge-schema-v1'

async function setup() {
  const fixture = await crmTimelineFixture()
  for (const sql of mergeSchemaV1) fixture.sqlite.exec(sql)
  const membership = fixture.sqlite
    .prepare('SELECT revision FROM vc_site_memberships WHERE site_id=? AND user_id=2')
    .get('default') as { revision: number }
  await new OrganizationRepository(fixture.db, 1).setMembership({
    site: 'default',
    user: 2,
    role: 'editor',
    active: true,
    expectedRevision: membership.revision,
    operationKey: crypto.randomUUID(),
  })
  const duplicate = String(
    (
      await new ContactRepository(fixture.db, 1).create({
        site: 'default',
        profile: { kind: 'person', firstName: 'Fictional merge duplicate' },
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
        name: 'Fictional merge giving',
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
  return { ...fixture, input: { site: 'default', survivor: fixture.contact, duplicate } }
}

it('allows fully authorized non-administrator staff to prepare a pair and its financial inventory', async () => {
  const fixture = await setup()
  try {
    expect(fixture.sqlite.prepare('SELECT role FROM users WHERE id=2').get()).toEqual({
      role: 'editor',
    })
    expect(
      fixture.sqlite
        .prepare('SELECT count(*) n FROM vc_installation_operators WHERE user_id=2')
        .get(),
    ).toEqual({ n: 0 })
    const access = new MergeAccess(fixture.db, 2)
    const pair = await access.pair(fixture.input)
    expect(pair.survivor.canEditProfile).toBe(true)
    const page = await access.inventoryPage({ ...fixture.input, kind: 'gifts' })
    expect(page.docs).toHaveLength(1)
    expect(page.docs[0].original_minor).toBe('1000')
    expect(page.authorityRevision).toBe(pair.scope.authorityRevision)
  } finally {
    fixture.close()
  }
})

it.each(['read', 'edit'])(
  'requires financial %s access rather than treating identity access as a merge grant',
  async (operation) => {
    const fixture = await setup()
    try {
      const before = fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts').all()
      fixture.sqlite
        .prepare(
          'INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,2,?,?)',
        )
        .run('default', 'finances', operation)
      const access = new MergeAccess(fixture.db, 2)
      await access.pair(fixture.input)
      await expect(
        access.inventoryPage({ ...fixture.input, kind: 'gifts' }),
      ).rejects.toBeInstanceOf(SiteAccessError)
      expect(fixture.sqlite.prepare('SELECT * FROM vc_crm_gifts').all()).toEqual(before)
    } finally {
      fixture.close()
    }
  },
)

it('rejects unrelated roots and revoked shared-profile authority', async () => {
  const fixture = await setup()
  try {
    const access = new MergeAccess(fixture.db, 2)
    const other = await new OrganizationRepository(fixture.db, 1).createOrganization({
      name: 'Foreign merge organization',
      siteName: 'Foreign merge site',
      operationKey: crypto.randomUUID(),
    })
    const foreign = String(
      (
        await new ContactRepository(fixture.db, 1).create({
          site: String(other.site),
          profile: { kind: 'person', firstName: 'Foreign profile' },
          roles: ['contact'],
          operationKey: crypto.randomUUID(),
        })
      ).id,
    )
    await expect(access.pair({ ...fixture.input, duplicate: foreign })).rejects.toBeInstanceOf(
      SiteAccessError,
    )
    fixture.sqlite
      .prepare(
        'INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,2,?,?)',
      )
      .run('default', 'identity', 'edit')
    await expect(access.pair(fixture.input)).rejects.toBeInstanceOf(SiteAccessError)
  } finally {
    fixture.close()
  }
})

it('does not let a chapter editor merge shared identities whose source profiles they cannot edit', async () => {
  const fixture = await setup()
  try {
    fixture.sqlite
      .prepare('UPDATE vc_site_websites SET subsites_enabled=1 WHERE site_id=?')
      .run('default')
    const parentRevision = (
      fixture.sqlite.prepare('SELECT revision FROM vc_sites WHERE id=?').get('default') as {
        revision: number
      }
    ).revision
    const child = await new OrganizationRepository(fixture.db, 1).createSite({
      parent: 'default',
      name: 'Fictional merge chapter',
      expectedRevision: parentRevision,
      operationKey: crypto.randomUUID(),
    })
    fixture.sqlite.exec(
      "INSERT INTO users(id,role,attribution_label) VALUES(3,'editor','Fictional chapter staff')",
    )
    fixture.sqlite
      .prepare("INSERT INTO vc_site_memberships(site_id,user_id,role) VALUES(?,3,'editor')")
      .run(String(child.site))
    const root = (await fixture.db
      .prepare('SELECT organization_id FROM vc_sites WHERE id=?')
      .bind('default')
      .first<{ organization_id: string }>())!.organization_id
    for (const id of [fixture.input.survivor, fixture.input.duplicate])
      fixture.sqlite
        .prepare(
          'INSERT INTO vc_crm_affiliations(id,organization_id,site_id,constituent_id,roles,created_at,updated_at) VALUES(?,?,?,?, \'["donor"]\',?,?)',
        )
        .run(
          crypto.randomUUID(),
          root,
          String(child.site),
          id,
          '2026-10-25T00:00:00.000Z',
          '2026-10-25T00:00:00.000Z',
        )
    const visible = await new ContactRepository(fixture.db, 3).get(
      String(child.site),
      fixture.input.survivor,
    )
    expect(visible.canEditChapter).toBe(true)
    expect(visible.canEditProfile).toBe(false)
    await expect(
      new MergeAccess(fixture.db, 3).pair({ ...fixture.input, site: String(child.site) }),
    ).rejects.toBeInstanceOf(SiteAccessError)
  } finally {
    fixture.close()
  }
})

it('does not return an inventory page when permissions are revoked after its data read', async () => {
  const fixture = await setup()
  try {
    let revoked = false
    const db = new Proxy(fixture.db, {
      get(target, property) {
        if (property !== 'prepare') return Reflect.get(target, property)
        return (sql: string) => {
          const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
            new Proxy(statement, {
              get(original, key) {
                if (key === 'bind') return (...args: unknown[]) => wrap(original.bind(...args))
                if (key === 'all')
                  return async () => {
                    const result = await original.all()
                    if (!revoked && sql.includes('SELECT r.*')) {
                      revoked = true
                      fixture.sqlite
                        .prepare(
                          'INSERT INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,2,?,?)',
                        )
                        .run('default', 'finances', 'edit')
                    }
                    return result
                  }
                const member = Reflect.get(original, key)
                return typeof member === 'function' ? member.bind(original) : member
              },
            })
          return wrap(target.prepare(sql))
        }
      },
    })
    await expect(
      new MergeAccess(db, 2).inventoryPage({ ...fixture.input, kind: 'gifts' }),
    ).rejects.toBeInstanceOf(SiteAccessError)
    expect(revoked).toBe(true)
  } finally {
    fixture.close()
  }
})
