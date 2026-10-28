import { atomicSiteMutation } from '../organizations/atomic'
import { intranetHomepageDefaults, intranetTemplateDefaults } from './portal-defaults'
import { appendPublishingVersion } from './native-version'
import { publishingDigest } from './legacy-content'

type Value = string | number | null
/** Installer/guarded-upgrade seed. Existing selections and authored documents
 * remain authoritative; ordinary releases never replace their customization.
 */
export async function seedPublishingPortals(db: D1Database, input: { actor: number; release: string }) {
  if (!Number.isSafeInteger(input.actor) || input.actor < 1 || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.release)) throw Error('A verified administrator and release identity are required.')
  const sites = await db.prepare('SELECT id,organization_id,name FROM vc_sites WHERE archived=0 ORDER BY id').all<{ id: string; organization_id: string; name: string }>()
  const records: Array<{ site: string; homepage: number | null; template: number | null; createdHomepage: boolean; createdTemplate: boolean; main: number | null }> = []
  const nextID = async (table: 'pages' | 'site_tpl' | 'menus') => {
    const row = await db.prepare(`SELECT COALESCE(MAX(id),0) id FROM "${table}"`).first<{ id: number }>()
    const sequences = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").first()
    const sequence = sequences ? await db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').bind(table).first<{ seq: number }>() : null
    return Math.max(Number(row?.id || 0), Number(sequence?.seq || 0)) + 1
  }
  const insert = (table: string, values: Record<string, Value>) => {
    if (!/^[a-z_]+$/.test(table) || Object.keys(values).some(key => !/^[a-z_]+$/.test(key))) throw Error('Unsupported seed schema identifier.')
    return db.prepare(`INSERT INTO "${table}"(${Object.keys(values).map(key => `"${key}"`).join(',')}) VALUES(${Object.keys(values).map(() => '?').join(',')})`).bind(...Object.values(values))
  }
  const unusedSlug = async (table: 'pages' | 'site_tpl', site: string, base: string) => {
    for (let index = 0; index < 100; index++) {
      const slug = base + (index ? `-${index + 1}` : '')
      if (!await db.prepare(`SELECT 1 FROM "${table}" WHERE platform_site=? AND audience='intranet' AND slug=?`).bind(site, slug).first()) return slug
    }
    throw Error('No safe default slug is available; preserve existing content and review the seed.')
  }
  for (const site of sites.results) {
    const authority = await db.prepare(`SELECT o.authority_revision FROM vc_organizations o WHERE o.id=?
      AND EXISTS(SELECT 1 FROM vc_active_tenant_administrators a WHERE a.tenant_id=o.id AND a.user_id=?)
      AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry n JOIN vc_sites p ON p.id=n.ancestor_id WHERE n.descendant_id=? AND p.archived=1)`)
      .bind(site.organization_id, input.actor, site.id).first<{ authority_revision: number }>()
    if (!authority) throw Error(`Portal initialization is not authorized for site ${site.id}.`)
    const current = await db.prepare('SELECT value,revision FROM vc_scoped_settings WHERE tenant_id=? AND scope=?').bind(site.organization_id, `site:${site.id}`).first<{ value: string; revision: number }>()
    const settings = current ? JSON.parse(current.value) as Record<string, unknown> : {}
    for (const [name, table, audience] of [['intranetHomepage', 'pages', 'intranet'], ['intranetSiteTemplate', 'site_tpl', 'intranet'], ['defaultSiteTemplate', 'site_tpl', 'public'], ['intranetPrimaryMenu', 'menus', 'intranet'], ['intranetFooterMenu', 'menus', 'intranet']] as const) {
      if (settings[name] != null && !await db.prepare(`SELECT 1 FROM "${table}" WHERE id=? AND platform_site=? AND audience=?${table === 'menus' ? '' : " AND _status='published'"}${table === 'pages' ? ' AND publishing_archived=0' : ''}`).bind(Number(settings[name]), site.id, audience).first())
        throw Error(`The existing ${name} selection requires review; it will not be overwritten.`)
    }
    if (await db.prepare('SELECT 1 FROM vc_publishing_portal_seeds WHERE site_id=?').bind(site.id).first()) {
      records.push({ site: site.id, homepage: settings.intranetHomepage == null ? null : Number(settings.intranetHomepage), template: settings.intranetSiteTemplate == null ? null : Number(settings.intranetSiteTemplate),
        createdHomepage: false, createdTemplate: false, main: settings.defaultSiteTemplate == null ? null : Number(settings.defaultSiteTemplate) })
      continue
    }
    const createHomepage = settings.intranetHomepage == null, createTemplate = settings.intranetSiteTemplate == null
    const homepage = createHomepage ? await nextID('pages') : Number(settings.intranetHomepage)
    const template = createTemplate ? await nextID('site_tpl') : Number(settings.intranetSiteTemplate)
    let menuID = await nextID('menus')
    const createPrimary = settings.intranetPrimaryMenu == null, createFooter = settings.intranetFooterMenu == null
    const primaryMenu = createPrimary ? menuID++ : Number(settings.intranetPrimaryMenu), footerMenu = createFooter ? menuID++ : Number(settings.intranetFooterMenu)
    const now = new Date().toISOString(), epoch = Number(authority.authority_revision) + 1
    const next = { ...settings, intranetHomepage: homepage, intranetSiteTemplate: template, intranetPrimaryMenu: primaryMenu, intranetFooterMenu: footerMenu }
    const key = await publishingDigest({ release: input.release, site: site.id, purpose: 'portal-defaults' }), fingerprint = await publishingDigest({ key, before: current, next, homepage, template })
    const statements: D1PreparedStatement[] = [
      db.prepare('INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_organizations WHERE id=? AND authority_revision=?').bind(`${key}:authority`, site.organization_id, epoch),
      db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(`${key}:authority`),
    ]
    for (const [slot, id, create] of [['primary', primaryMenu, createPrimary], ['footer', footerMenu, createFooter]] as const) if (create) {
      const seedKey = `seed:intranet-${slot}-menu:${site.id}`
      statements.push(insert('menus', { id, name: slot === 'primary' ? 'Intranet navigation' : 'Intranet footer', revision: 0,
        items: JSON.stringify([{ key: 'intranet-home', label: 'Home', kind: 'custom', url: '/intranet', enabled: true }, { key: 'intranet-news', label: 'News', kind: 'custom', url: '/intranet/posts', enabled: true }, { key: 'intranet-resources', label: 'Resources', kind: 'custom', url: '/intranet/resources', enabled: true }]),
        audience: 'intranet', platform_site: site.id, platform_write_actor: input.actor, platform_write_epoch: epoch, publishing_owner: input.actor,
        publishing_readership: 'site', publishing_people: '[]', publishing_groups: '[]', publishing_identity: seedKey, publishing_operation_key: seedKey, created_at: now, updated_at: now }))
    }
    if (createTemplate) {
      const defaults = intranetTemplateDefaults(), seedKey = `seed:intranet-template:${site.id}`
      statements.push(insert('site_tpl', { id: template, name: defaults.name, slug: await unusedSlug('site_tpl', site.id, defaults.slug), description: defaults.description,
        header_layout: JSON.stringify(defaults.header.layout), header_settings: JSON.stringify(defaults.header.settings), footer_layout: JSON.stringify(defaults.footer.layout), footer_settings: JSON.stringify(defaults.footer.settings),
        typography: JSON.stringify(defaults.typography), colors: JSON.stringify(defaults.colors), buttons: '{}', dimensions: JSON.stringify(defaults.dimensions), mobile: JSON.stringify(defaults.mobile), additional_c_s_s: '',
        assignment_mode: 'default', assignment_priority: 0, _status: 'published', publishing_published_at: now, audience: 'intranet', platform_site: site.id, platform_write_actor: input.actor, platform_write_epoch: epoch,
        publishing_owner: input.actor, publishing_readership: 'site', publishing_people: '[]', publishing_groups: '[]', publishing_identity: seedKey, publishing_operation_key: seedKey, created_at: now, updated_at: now }))
      statements.push(...await appendPublishingVersion(db, { collection: 'site-templates', id: template, key: seedKey, now, actor: input.actor, epoch }))
    }
    if (createHomepage) {
      const seedKey = `seed:intranet-home:${site.id}`, slug = await unusedSlug('pages', site.id, 'intranet-home')
      statements.push(insert('pages', { id: homepage, title: 'Intranet', slug, content_layout: JSON.stringify(intranetHomepageDefaults(String(settings.siteName || site.name), homepage)), responsive_designs: '{}',
        _status: 'published', published_at: now, publishing_published_at: now, audience: 'intranet', platform_site: site.id, platform_write_actor: input.actor, platform_write_epoch: epoch, publishing_owner: input.actor,
        publishing_readership: 'site', publishing_people: '[]', publishing_groups: '[]', publishing_archived: 0, publishing_identity: seedKey, publishing_operation_key: seedKey, created_at: now, updated_at: now }),
        insert('pages_breadcrumbs', { id: seedKey, _order: 1, _parent_id: homepage, doc_id: homepage, url: `/${slug}`, label: 'Intranet' }))
      statements.push(...await appendPublishingVersion(db, { collection: 'pages', id: homepage, key: seedKey, now, actor: input.actor, epoch }))
    }
    statements.push(insert('vc_publishing_portal_seeds', { site_id: site.id, version: 1, created_at: now }), insert('vc_platform_audit', { id: crypto.randomUUID(), organization_id: site.organization_id, site_id: site.id, actor_id: input.actor,
      action: 'publishing.portal-initialized', record_type: 'site', record_id: site.id, after_value: JSON.stringify({ homepage, template, release: input.release }), operation_key: key, created_at: now }))
    await atomicSiteMutation(db, { actor: input.actor, operationKey: key, fingerprint,
      write: current ? db.prepare('UPDATE vc_scoped_settings SET value=?,revision=revision+1 WHERE tenant_id=? AND scope=? AND revision=?').bind(JSON.stringify(next), site.organization_id, `site:${site.id}`, current.revision)
        : db.prepare('INSERT INTO vc_scoped_settings(tenant_id,scope,site_id,value) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(site.organization_id, `site:${site.id}`, site.id, JSON.stringify(next)),
      afterWrite: statements, result: { site: site.id, homepage, template } })
    records.push({ site: site.id, homepage, template, createdHomepage: createHomepage, createdTemplate: createTemplate, main: settings.defaultSiteTemplate == null ? null : Number(settings.defaultSiteTemplate) })
  }
  if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length) throw Error('Portal initialization failed foreign-key validation.')
  return { status: 'passed', records }
}
