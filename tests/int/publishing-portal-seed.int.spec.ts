import { expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { migrateDatabase } from '../../scripts/lib/migrate-database'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { seedPublishingPortals } from '@/publishing/portal-seed'

async function fixture() {
  const f = localD1()
  await migrateDatabase(f.db)
  f.sqlite.exec("INSERT INTO users(id,email,role) VALUES(1,'portal-owner@example.invalid','administrator')")
  await bootstrapTenant(f.db, { tenant: 'default', site: 'default', administratorEmail: 'portal-owner@example.invalid' })
  await activateTenantAuthority(f.db, 'default')
  f.sqlite.exec("UPDATE vc_scoped_settings SET value=json_set(value,'$.defaultSiteTemplate',1) WHERE scope='site:default'")
  return f
}
const operation = { actor: 1, release: 'portal_seed_fixture_123456789' }

it('creates editable internal defaults and separate menus without changing the public shell, then preserves customizations and cleared selections', async () => {
  const f = await fixture()
  try {
    const main = f.sqlite.prepare('SELECT * FROM site_tpl WHERE id=1').get()
    const first = await seedPublishingPortals(f.db, operation), seeded = first.records[0]
    expect(seeded.createdHomepage).toBe(true)
    expect(seeded.createdTemplate).toBe(true)
    const settings = JSON.parse(String(f.sqlite.prepare("SELECT value FROM vc_scoped_settings WHERE scope='site:default'").get()!.value))
    expect(settings.defaultSiteTemplate).toBe(1)
    expect(settings.intranetPrimaryMenu).not.toBe(settings.intranetFooterMenu)
    expect(f.sqlite.prepare('SELECT * FROM site_tpl WHERE id=1').get()).toEqual(main)
    expect(f.sqlite.prepare('SELECT name,audience FROM site_tpl WHERE id=?').get(seeded.template)).toEqual({ name: 'Intranet', audience: 'intranet' })
    expect(JSON.parse(String(f.sqlite.prepare('SELECT content_layout FROM pages WHERE id=?').get(seeded.homepage)!.content_layout)).nodes.some((node: { kind: string }) => node.kind === 'postListing')).toBe(true)
    const counts = () => f.sqlite.prepare('SELECT (SELECT COUNT(*) FROM pages) pages,(SELECT COUNT(*) FROM site_tpl) templates,(SELECT COUNT(*) FROM menus) menus').get()
    const before = counts()
    expect((await seedPublishingPortals(f.db, operation)).records[0].createdHomepage).toBe(false)
    expect(counts()).toEqual(before)
    const epoch = f.sqlite.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").get()!.authority_revision
    f.sqlite.prepare("UPDATE pages SET title='My customized portal',platform_write_actor=1,platform_write_epoch=? WHERE id=?").run(epoch, seeded.homepage)
    f.sqlite.exec("UPDATE vc_scoped_settings SET value=json_set(value,'$.intranetHomepage',NULL,'$.intranetSiteTemplate',NULL,'$.intranetPrimaryMenu',NULL,'$.intranetFooterMenu',NULL),revision=revision+1 WHERE scope='site:default'")
    const again = await seedPublishingPortals(f.db, { ...operation, release: 'another_release_fixture_123456789' })
    expect(again.records[0].homepage).toBeNull()
    expect(again.records[0].template).toBeNull()
    expect(counts()).toEqual(before)
    expect(f.sqlite.prepare('SELECT title FROM pages WHERE id=?').get(seeded.homepage)!.title).toBe('My customized portal')
    expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally { f.close() }
})

it('retains an existing internal homepage and blocks a public record mistakenly assigned internally', async () => {
  const f = await fixture()
  try {
    const epoch = f.sqlite.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").get()!.authority_revision
    f.sqlite.prepare("INSERT INTO pages(id,title,slug,_status,audience,platform_site,platform_write_actor,platform_write_epoch,publishing_owner) VALUES(25,'Custom home','custom-home','published','intranet','default',1,?,1)").run(epoch)
    f.sqlite.exec("UPDATE vc_scoped_settings SET value=json_set(value,'$.intranetHomepage',25) WHERE scope='site:default'")
    expect((await seedPublishingPortals(f.db, operation)).records[0]).toMatchObject({ homepage: 25, createdHomepage: false })
    expect(f.sqlite.prepare('SELECT title FROM pages WHERE id=25').get()!.title).toBe('Custom home')
    const latest = f.sqlite.prepare("SELECT authority_revision FROM vc_organizations WHERE id='default'").get()!.authority_revision
    f.sqlite.prepare("INSERT INTO pages(id,title,slug,_status,audience,platform_site,platform_write_actor,platform_write_epoch) VALUES(1,'Public page','public-page','published','public','default',1,?)").run(latest)
    f.sqlite.exec("UPDATE vc_scoped_settings SET value=json_set(value,'$.intranetHomepage',1) WHERE scope='site:default'")
    await expect(seedPublishingPortals(f.db, operation)).rejects.toThrow('will not be overwritten')
  } finally { f.close() }
})
