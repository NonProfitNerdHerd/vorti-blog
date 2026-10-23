import { getPlatformProxy, type PlatformProxy } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { organizationSchema, defaultOrganizationSeed } from '../../src/organizations/schema'
import { websiteSchemaV1 } from '../../src/organizations/website-schema-v1'
import { WebsiteRepository, websiteStatus } from '../../src/organizations/websites'
import { OrganizationRepository } from '../../src/organizations/repository'
import { publicWebsite } from '../../src/organizations/public-website'
import { initializeWebsite, WEBSITE_COPY_KEY } from '../../src/organizations/website-copy'
import { CMS_SITE } from '../../src/organizations/cms-scope'
import { SiteConflictError } from '../../src/organizations/atomic'
import { saveWebsiteSettings } from '../../src/organizations/website-settings'
import { validateMenuItems } from '@design-system/payload-design-core'
import type { PayloadRequest } from 'payload'

describe('SubSites availability on actual D1', () => {
  let proxy: PlatformProxy<{ D1: D1Database }>
  let db: D1Database
  beforeAll(async () => {
    proxy = await getPlatformProxy({
      configPath: 'tests/fixtures/organization-worker/wrangler.jsonc',
      persist: false,
      remoteBindings: false,
    })
    db = proxy.env.D1
    await db.prepare('CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT)').run()
    await db.prepare("INSERT INTO users VALUES(1,'administrator')").run()
    for (const statement of [...organizationSchema, ...defaultOrganizationSeed, ...websiteSchemaV1])
      await db.prepare(statement).run()
  })
  afterAll(async () => {
    await proxy?.dispose()
  })
  const key = () => crypto.randomUUID()
  async function toggle(site: string, enabled: boolean) {
    const status = await websiteStatus(db, site)
    return new WebsiteRepository(db, 1).update({
      site,
      action: 'subsites',
      enabled,
      expectedRevision: status.revision,
      confirmedDescendants: status.descendants,
      operationKey: key(),
    })
  }
  it('defaults disabled and prevents operator provisioning below a disabled root', async () => {
    expect((await websiteStatus(db, 'default')).subsites_enabled).toBe(0)
    await expect(
      new OrganizationRepository(db, 1).createSite({
        parent: 'default',
        name: 'Region',
        expectedRevision: 1,
        operationKey: key(),
      }),
    ).rejects.toThrow()
  })
  it('allows a region only after enabling its parent and cannot override a later parent pause', async () => {
    await toggle('default', true)
    const parent = await new OrganizationRepository(db, 1).require(
      'default',
      'identity',
      'configure',
    )
    const created = await new OrganizationRepository(db, 1).createSite({
      parent: 'default',
      name: 'Region',
      expectedRevision: parent.revision,
      operationKey: key(),
    })
    const region = String(created.site)
    await toggle(region, true)
    await toggle('default', false)
    expect((await websiteStatus(db, region)).controller?.id).toBe('default')
    await expect(toggle(region, true)).rejects.toThrow('disabled by')
    await toggle('default', true)
    expect((await websiteStatus(db, region)).controller).toBeNull()
    expect((await websiteStatus(db, region)).subsites_enabled).toBe(1)
  })
  it('requires an accurate pause confirmation and rejects stale revisions', async () => {
    const status = await websiteStatus(db, 'default')
    const repository = new WebsiteRepository(db, 1)
    await expect(
      repository.update({
        site: 'default',
        action: 'subsites',
        enabled: false,
        expectedRevision: status.revision,
        confirmedDescendants: 0,
        operationKey: key(),
      }),
    ).rejects.toThrow()
    await expect(
      repository.update({
        site: 'default',
        action: 'subsites',
        enabled: false,
        expectedRevision: status.revision - 1,
        confirmedDescendants: status.descendants,
        operationKey: key(),
      }),
    ).rejects.toThrow()
    expect((await websiteStatus(db, 'default')).subsites_enabled).toBe(1)
  })
  it('pauses descendants without pausing the controlling site and restores publication on re-enable', async () => {
    const region = (await db
      .prepare("SELECT id FROM vc_sites WHERE name='Region'")
      .first<{ id: string }>())!.id
    await db.prepare('UPDATE vc_site_websites SET initialized=1 WHERE site_id=?').bind(region).run()
    let status = await websiteStatus(db, region)
    await new WebsiteRepository(db, 1).update({
      site: region,
      action: 'publication',
      enabled: true,
      expectedRevision: status.revision,
      operationKey: key(),
    })
    expect(await publicWebsite(db, region)).not.toBeNull()
    await toggle(region, false)
    expect(await publicWebsite(db, region)).not.toBeNull()
    await toggle('default', false)
    expect(await publicWebsite(db, region)).toBeNull()
    await toggle('default', true)
    expect(await publicWebsite(db, region)).not.toBeNull()
    status = await websiteStatus(db, region)
    await new WebsiteRepository(db, 1).update({
      site: region,
      action: 'publication',
      enabled: false,
      expectedRevision: status.revision,
      operationKey: key(),
    })
    expect(await publicWebsite(db, region)).toBeNull()
    expect(await publicWebsite(db, region, true)).not.toBeNull()
  })
  it('retries an interrupted design copy without copying content, private data, or duplicate dependencies', async () => {
    const parent = await new OrganizationRepository(db, 1).require(
      'default',
      'identity',
      'configure',
    )
    const child = String(
      (
        await new OrganizationRepository(db, 1).createSite({
          parent: 'default',
          name: 'Copy target',
          routeKey: 'copy-target',
          expectedRevision: parent.revision,
          operationKey: key(),
        })
      ).site,
    )
    const source: Record<string, Record<number, Record<string, unknown>>> = {
      'site-templates': {
        1: {
          id: 1,
          name: 'Parent shell',
          slug: 'parent-shell',
          _status: 'published',
          header: { layout: [{ blockType: 4, blockDesign: 5 }] },
        },
      },
      'design-block-types': { 4: { id: 4, name: 'Hero', slug: 'hero', rendererKey: 'hero' } },
      'design-block-designs': {
        5: { id: 5, name: 'Hero style', slug: 'hero-style', blockType: 4 },
      },
      media: { 3: { id: 3, alt: 'Brand', filename: 'brand.png', mimeType: 'image/png' } },
      menus: {
        6: {
          id: 6,
          name: 'Parent navigation',
          slug: 'parent-navigation',
          items: [
            { key: 'private', label: 'Uncopied private page', kind: 'page', target: 90 },
            {
              key: 'external',
              parent: 'private',
              label: 'External menu',
              kind: 'custom',
              url: 'https://example.invalid/menu',
            },
            {
              key: 'email',
              label: 'Email',
              kind: 'custom',
              url: 'mailto:fictional@example.invalid',
            },
          ],
        },
      },
    }
    const records: Array<{
      id: number
      key: string
      collection: string
      data: Record<string, unknown>
    }> = []
    const schema = [
      {
        slug: 'site-templates',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'header', type: 'group', fields: [{ name: 'layout', type: 'json' }] },
        ],
      },
      {
        slug: 'design-block-types',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'rendererKey', type: 'text' },
        ],
      },
      {
        slug: 'design-block-designs',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'blockType', type: 'relationship', relationTo: 'design-block-types' },
        ],
      },
      { slug: 'media', fields: [{ name: 'alt', type: 'text' }] },
      {
        slug: 'menus',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'items', type: 'json' },
        ],
      },
    ]
    const payload = {
      db: { client: db },
      config: {
        collections: schema,
        globals: [
          {
            slug: 'site-settings',
            fields: [
              { name: 'siteName', type: 'text' },
              { name: 'defaultSiteTemplate', type: 'relationship', relationTo: 'site-templates' },
              { name: 'logo', type: 'upload', relationTo: 'media' },
            ],
          },
        ],
      },
      findGlobal: async ({ slug }: { slug: string }) =>
        slug === 'site-settings'
          ? { siteName: 'Parent', defaultSiteTemplate: 1, logo: 3 }
          : {
              primaryMenu: 6,
              primary: [
                { label: 'Private page', linkType: 'internal', page: 90 },
                { label: 'External', linkType: 'external', url: 'https://example.invalid' },
              ],
            },
      find: async (args: { where: { websiteCopyKey: { equals: string } } }) => ({
        docs: records.filter((row) => row.key === args.where.websiteCopyKey.equals),
      }),
      findByID: async (args: { collection: string; id: number; req: PayloadRequest }) => {
        expect((args.req.context as Record<symbol, unknown>)[CMS_SITE]).toBe('default')
        return structuredClone(source[args.collection][args.id])
      },
      create: async (args: {
        collection: string
        data: Record<string, unknown>
        req: PayloadRequest
      }) => {
        expect((args.req.context as Record<symbol, unknown>)[CMS_SITE]).toBe(child)
        const copyKey = String((args.req.context as Record<symbol, unknown>)[WEBSITE_COPY_KEY])
        expect(records.some((row) => row.key === copyKey)).toBe(false)
        const row = {
          id: 1000 + records.length,
          key: copyKey,
          collection: args.collection,
          data: args.data,
        }
        records.push(row)
        return row
      },
    }
    let fail = true
    const bucket = {
      get: async () => {
        if (fail) {
          fail = false
          throw new Error('Interrupted asset copy')
        }
        return { size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }
      },
    } as unknown as R2Bucket
    const req = {
      payload,
      user: { id: 1 },
      context: {},
      headers: new Headers(),
    } as unknown as PayloadRequest
    await expect(
      initializeWebsite(req, child, bucket, (await websiteStatus(db, child)).revision + 1),
    ).rejects.toThrow(SiteConflictError)
    expect(records).toHaveLength(0)
    await expect(initializeWebsite(req, child, bucket)).rejects.toThrow('Interrupted asset copy')
    expect((await websiteStatus(db, child)).initialized).toBe(0)
    await initializeWebsite(req, child, bucket)
    expect(records).toHaveLength(5)
    const copiedTemplate = records.find((row) => row.collection === 'site-templates')!
    const type = records.find((row) => row.collection === 'design-block-types')!
    expect(
      (copiedTemplate.data.header as { layout: Array<{ blockType: number }> }).layout[0].blockType,
    ).toBe(type.id)
    expect(
      (source['site-templates'][1].header as { layout: Array<{ blockType: number }> }).layout[0]
        .blockType,
    ).toBe(4)
    expect(JSON.parse((await websiteStatus(db, child)).navigation).primary).toEqual([
      { label: 'External', linkType: 'external', url: 'https://example.invalid', children: [] },
    ])
    const menu = records.find((row) => row.collection === 'menus')!
    expect(JSON.parse((await websiteStatus(db, child)).navigation).primaryMenu).toBe(menu.id)
    expect(menu.data.items).toEqual([
      {
        key: 'external',
        parent: null,
        label: 'External menu',
        kind: 'custom',
        url: 'https://example.invalid/menu',
        children: [],
      },
      {
        key: 'email',
        label: 'Email',
        kind: 'custom',
        url: 'mailto:fictional@example.invalid',
        children: [],
      },
    ])
    expect(validateMenuItems(menu.data.items)).toBe(true)
    await saveWebsiteSettings(req, {
      site: child,
      settings: {
        siteName: 'Fictional child',
        siteDescription: null,
        discourageSearchIndexing: null,
      },
      expectedRevision: (await websiteStatus(db, child)).revision,
      operationKey: crypto.randomUUID(),
    })
    const normalized = JSON.parse((await websiteStatus(db, child)).presentation)
    expect(normalized.siteDescription).toBe('')
    expect(normalized.discourageSearchIndexing).toBe(false)
    await initializeWebsite(req, child, bucket)
    expect(records).toHaveLength(5)
    expect(await publicWebsite(db, child)).toBeNull()
  })
  it('rolls back a pending availability mutation when account authority is revoked', async () => {
    const before = await websiteStatus(db, 'default')
    const raced = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        await db.prepare('DELETE FROM vc_installation_operators WHERE user_id=1').run()
        return db.batch(statements)
      },
    } as unknown as D1Database
    await expect(
      new WebsiteRepository(raced, 1).update({
        site: 'default',
        action: 'subsites',
        enabled: false,
        expectedRevision: before.revision,
        confirmedDescendants: before.descendants,
        operationKey: key(),
      }),
    ).rejects.toThrow()
    expect((await websiteStatus(db, 'default')).subsites_enabled).toBe(1)
  })
})
