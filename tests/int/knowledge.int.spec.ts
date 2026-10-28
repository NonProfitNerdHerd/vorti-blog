import { describe, expect, it } from 'vitest'
import { localD1 } from '../helpers/local-d1'
import { migrateDatabase } from '../../scripts/lib/migrate-database'
import { bootstrapTenant, activateTenantAuthority } from '../../scripts/lib/bootstrap-tenant'
import { KnowledgeRepository } from '../../src/knowledge/repository'
import { emptyKnowledgeBody, validateKnowledgeBody } from '../../src/knowledge/content'
import { WebsiteRepository } from '../../src/organizations/websites'
import { publicWebsite } from '../../src/organizations/public-website'

async function fixture() {
  const f = localD1()
  await migrateDatabase(f.db)
  f.sqlite.exec(
    "INSERT INTO users(id,email,role) VALUES(1,'owner@example.com','administrator'),(2,'member@example.com','editor')",
  )
  await bootstrapTenant(f.db, {
    tenant: 'default',
    site: 'default',
    administratorEmail: 'owner@example.com',
  })
  await activateTenantAuthority(f.db, 'default')
  f.sqlite.exec("UPDATE vc_site_websites SET initialized=1,published=1 WHERE site_id='default'")
  return {
    ...f,
    admin: new KnowledgeRepository(f.db, 1),
    public: new KnowledgeRepository(f.db, null),
  }
}
const draft = (id: string, parent: string | null = null) => ({
  id,
  parent,
  site: 'default',
  kind: 'wiki' as const,
  title: id,
  slug: id,
  body: emptyKnowledgeBody,
  visibility: 'private' as 'private' | 'public',
  expectedRevision: 0,
  operationKey: crypto.randomUUID(),
  action: 'save' as 'save' | 'publish' | 'unpublish' | 'delete',
})

describe('Wiki and Intranet boundaries', () => {
  it('withholds private ancestry from reads/search, keeps published text separate and audits administrator access', async () => {
    const f = await fixture()
    try {
      const root = draft('root'),
        child = { ...draft('child', 'root'), visibility: 'public' as const }
      await f.admin.save(root)
      await f.admin.save({
        ...root,
        expectedRevision: 1,
        action: 'publish',
        operationKey: crypto.randomUUID(),
      })
      await f.admin.save(child)
      await f.admin.save({
        ...child,
        expectedRevision: 1,
        action: 'publish',
        operationKey: crypto.randomUUID(),
      })
      expect((await f.public.list('default', 'wiki')).docs).toEqual([])
      await expect(f.public.get('default', 'wiki', 'child')).rejects.toMatchObject({ status: 404 })
      await f.admin.save({
        ...root,
        visibility: 'public',
        expectedRevision: 2,
        operationKey: crypto.randomUUID(),
      })
      expect((await f.public.list('default', 'wiki')).docs).toHaveLength(2)
      await f.admin.save({
        ...child,
        title: 'Secret draft title',
        expectedRevision: 2,
        operationKey: crypto.randomUUID(),
      })
      expect((await f.public.get('default', 'wiki', 'child')).title).toBe('child')
      expect((await f.public.list('default', 'wiki', { search: 'Secret' })).docs).toEqual([])
      expect((await f.admin.get('default', 'wiki', 'child', true)).title).toBe('Secret draft title')
      expect(await f.admin.versions('default', 'wiki', 'child')).toHaveLength(3)
      expect(
        Number(
          f.sqlite
            .prepare(
              "SELECT count(*) AS n FROM vc_platform_audit WHERE action='tenant-administrator.read'",
            )
            .get()?.n,
        ),
      ).toBeGreaterThan(0)
      expect(() => f.sqlite.exec("UPDATE vc_knowledge_versions SET title='rewritten'")).toThrow(
        /immutable/,
      )
    } finally {
      f.close()
    }
  })
  it('retains Wiki hierarchy, private access and feature controls after unified Intranet publishing is installed', async () => {
    const f = await fixture()
    try {
      const root = draft('internal-root'),
        child = draft('internal-child', 'internal-root')
      await f.admin.save(root)
      await f.admin.save({
        ...root,
        expectedRevision: 1,
        action: 'publish',
        operationKey: crypto.randomUUID(),
      })
      await f.admin.save(child)
      await expect(
        f.admin.save({
          ...root,
          parent: 'internal-child',
          expectedRevision: 2,
          operationKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/hierarchy/)
      expect(
        f.sqlite.prepare("SELECT parent_id FROM vc_knowledge_pages WHERE id='internal-root'").get()
          ?.parent_id,
      ).toBeNull()
      f.sqlite.exec("INSERT INTO vc_sites(id,organization_id,parent_id,name,route_key,created_at,updated_at) VALUES('other','default','default','Other','other','2026-10-27T00:00:00.000Z','2026-10-27T00:00:00.000Z'); INSERT INTO vc_site_ancestry(ancestor_id,descendant_id,distance) VALUES('default','other',1),('other','other',0)")
      const wiki = { ...draft('wiki-root'), site: 'other' }
      await f.admin.save(wiki)
      await expect(
        f.admin.save({
          ...child,
          parent: 'wiki-root',
          expectedRevision: 1,
          operationKey: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 403 })
      const websites = new WebsiteRepository(f.db, 1)
      const current = await websites.status('default')
      await websites.update({site:'default',action:'publication',enabled:false,expectedRevision:current.revision,operationKey:crypto.randomUUID()})
      expect(await publicWebsite(f.db,'default')).toBeNull()
      expect((await f.admin.get('default', 'wiki', 'internal-root')).title).toBe(
        'internal-root',
      )
      await expect(f.public.list('default', 'wiki')).rejects.toMatchObject({ status: 404 })
      await expect(
        new KnowledgeRepository(f.db, 2).get('default', 'wiki', 'internal-root'),
      ).rejects.toMatchObject({ status: 403 })
      f.sqlite.exec(
        "UPDATE vc_tenant_features SET available=0 WHERE tenant_id='default' AND feature='wiki'",
      )
      await expect(f.admin.get('default', 'wiki', 'internal-root')).rejects.toMatchObject({
        status: 403,
      })
      expect(
        f.sqlite.prepare("SELECT count(*) AS n FROM vc_knowledge_pages WHERE kind='wiki'").get()
          ?.n,
      ).toBe(3)
    } finally {
      f.close()
    }
  })
  it('rejects executable links and arbitrary serialized nodes', () => {
    expect(() =>
      validateKnowledgeBody({
        root: {
          type: 'root',
          children: [{ type: 'link', url: 'javascript:alert(1)', children: [] }],
        },
      }),
    ).toThrow(/safe link/)
    expect(() =>
      validateKnowledgeBody({
        root: { type: 'root', children: [{ type: 'html', html: '<script>x</script>' }] },
      }),
    ).toThrow(/Unsupported/)
  })
})
