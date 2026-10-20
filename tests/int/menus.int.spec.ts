import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { resolveMenu } from '@/menus/server'
import { resolveDocumentBlocks } from '@/lib/content-layout'
import type { MenuItem } from '@design-system/payload-design-core'
import { up } from '@/migrations/20261020_170954_reusable_menus'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
describe('named menus, authorization and public rendering', () => {
  let payload: Payload, user: User
  const req = () => createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  const stamp = Date.now()
  beforeAll(async () => {
    payload = await getPayload({ config })
    await up({ db: (payload.db as unknown as { drizzle: unknown }).drizzle } as never)
    user = await payload.create({
      collection: 'users',
      data: {
        username: `menu-${stamp}`,
        email: `menu-${stamp}@example.invalid`,
        password: 'local-menu-password',
        role: 'editor',
      },
    })
  }, 180000)
  it('keeps raw menus authenticated and validates direct writes', async () => {
    await expect(payload.find({ collection: 'menus', overrideAccess: false })).rejects.toThrow()
    for (const items of [
      [{ key: 'bad', label: 'Bad', kind: 'custom', url: 'javascript:alert(1)' }],
      [{ key: 'a', parent: 'a', label: 'Cycle', kind: 'custom', url: '/a' }],
      [{ key: 'missing', label: 'Missing', kind: 'page' }],
      [{ key: 'bad-page', label: 'Unavailable', kind: 'page', target: 999999999 }],
    ])
      await expect(
        payload.create({
          collection: 'menus',
          overrideAccess: false,
          req: await req(),
          data: { name: 'Invalid', items },
        }),
      ).rejects.toThrow()
  })
  it('resolves only public destinations, hides their descendants and uses stable IDs after edits', async () => {
    const page = await payload.create({
      collection: 'pages',
      data: { title: 'Menu page', slug: `menu-page-${stamp}`, _status: 'published' },
    })
    const draft = await payload.create({
      collection: 'pages',
      data: { title: 'Private draft', slug: `menu-draft-${stamp}`, _status: 'draft' },
    })
    const post = await payload.create({
      collection: 'posts',
      data: {
        title: 'Menu post',
        slug: `menu-post-${stamp}`,
        author: user.id,
        _status: 'published',
      },
    })
    const items: MenuItem[] = [
      { key: 'page', label: 'Page', kind: 'page', target: page.id },
      { key: 'post', label: 'Article', kind: 'post', target: post.id },
      { key: 'draft', label: 'Private', kind: 'page', target: draft.id },
      {
        key: 'draft-child',
        parent: 'draft',
        label: 'Secret branch',
        kind: 'custom',
        url: '/hidden',
      },
      { key: 'disabled', label: 'Disabled', kind: 'custom', url: '/disabled', enabled: false },
      {
        key: 'external',
        label: 'External',
        kind: 'custom',
        url: 'https://example.com',
        newTab: true,
      },
    ]
    const menu = await payload.create({
      collection: 'menus',
      req: await req(),
      overrideAccess: false,
      data: { name: 'Public links', items },
    })
    const publicMenu = await resolveMenu(payload, menu.id)
    expect(publicMenu?.items.map((item) => item.key)).toEqual(['page', 'post', 'external'])
    expect(JSON.stringify(publicMenu)).not.toMatch(/Private|Secret|Disabled|target|updatedAt/)
    expect(publicMenu?.items[0].href).toBe(`/${page.slug}`)
    expect(publicMenu?.items[1].href).toBe(`/posts/${post.slug}`)
    const changed = await payload.update({
      collection: 'menus',
      id: menu.id,
      req: await req(),
      overrideAccess: false,
      data: {
        name: 'Renamed',
        items: items.map((item) =>
          item.key === 'page' ? { ...item, label: 'Updated link' } : item,
        ),
        expectedUpdatedAt: menu.updatedAt,
      },
    })
    expect(changed.revision).toBe(1)
    await expect(
      payload.update({
        collection: 'menus',
        id: menu.id,
        req: await req(),
        overrideAccess: false,
        data: { name: 'Stale write', expectedUpdatedAt: menu.updatedAt },
      }),
    ).rejects.toThrow(/changed/)
    const resolved = await resolveDocumentBlocks(payload, {
      title: 'Sample',
      contentLayout: {
        version: 1,
        nodes: [
          {
            id: 'menu-placement',
            kind: 'menu',
            props: {
              menuID: String(menu.id),
              resolvedMenu: { name: 'Forged', items: [{ label: 'Secret' }] },
            },
          },
        ],
      },
    })
    expect(resolved?.[0].props?.resolvedMenu).toMatchObject({
      name: 'Renamed',
      items: [
        expect.objectContaining({ label: 'Updated link' }),
        expect.anything(),
        expect.anything(),
      ],
    })
    await payload.update({ collection: 'pages', id: page.id, data: { _status: 'draft' } })
    expect((await resolveMenu(payload, menu.id))?.items.map((item) => item.key)).toEqual([
      'post',
      'external',
    ])
    const global = await payload.findGlobal({ slug: 'navigation', depth: 0 })
    await payload.updateGlobal({
      slug: 'navigation',
      data: { primaryMenu: menu.id, expectedUpdatedAt: global.updatedAt },
    })
    expect(
      (await payload.findGlobal({ slug: 'navigation', overrideAccess: false })).primary?.map(
        (item) => item.label,
      ),
    ).toEqual(['Article', 'External'])
    await payload.delete({
      collection: 'menus',
      id: menu.id,
      req: await req(),
      overrideAccess: false,
    })
    expect(await resolveMenu(payload, menu.id)).toBeNull()
    expect((await payload.findGlobal({ slug: 'navigation' })).primary).toEqual([])
  })
  it('rejects overlapping revisions at the database boundary', async () => {
    const menu = await payload.create({
      collection: 'menus',
      data: { name: 'Concurrent menu', items: [] },
    })
    const client = (payload.db as unknown as { client: D1Database }).client
    await client
      .prepare('UPDATE menus SET name=?,revision=revision+1 WHERE id=?')
      .bind('First save', menu.id)
      .run()
    await expect(
      client
        .prepare('UPDATE menus SET name=?,revision=? WHERE id=?')
        .bind('Overlapping save', 1, menu.id)
        .run(),
    ).rejects.toThrow(/changed/)
  })
  it('uses the configured homepage and published custom post-type routes', async () => {
    const home = await payload.create({
      collection: 'pages',
      data: { title: 'Menu home', slug: `menu-home-${stamp}`, _status: 'published' },
    })
    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { siteName: settings.siteName || 'Menu test site', homepage: home.id },
    })
    const type = await payload.create({
      collection: 'post-types',
      data: {
        key: `menu-type-${stamp}`,
        singular: 'Menu Event',
        plural: 'Menu Events',
        prefix: `menu-events-${stamp}`,
        capability: 'content',
        _status: 'published',
      },
    })
    const post = await payload.create({
      collection: 'posts',
      data: {
        title: 'Typed link',
        slug: `typed-menu-${stamp}`,
        author: user.id,
        postType: type.id,
        _status: 'published',
      },
    })
    const menu = await payload.create({
      collection: 'menus',
      data: {
        name: 'Routing menu',
        items: [
          { key: 'home', label: 'Home', kind: 'page', target: home.id },
          { key: 'post', label: 'Typed post', kind: 'post', target: post.id },
        ],
      },
    })
    expect((await resolveMenu(payload, menu.id))?.items.map((item) => item.href)).toEqual([
      '/',
      `/${type.prefix}/${post.slug}`,
    ])
    await payload.update({ collection: 'post-types', id: type.id, data: { _status: 'draft' } })
    expect((await resolveMenu(payload, menu.id))?.items.map((item) => item.key)).toEqual(['home'])
    await payload.updateGlobal({
      slug: 'site-settings',
      data: {
        homepage:
          typeof settings.homepage === 'object' ? settings.homepage?.id : settings.homepage || null,
      },
    })
  })
  it('keeps the legacy rows untouched when changing default locations', async () => {
    const client = (payload.db as unknown as { client: D1Database }).client
    const global = await payload.findGlobal({ slug: 'navigation', depth: 0 })
    const id = `legacy-preserve-${stamp}`
    await client
      .prepare(
        'INSERT INTO navigation_primary(_order,_parent_id,id,label,link_type,url,enabled,new_tab) VALUES(1,?,?,?,?,?,1,0)',
      )
      .bind(global.id, id, 'Historical menu row', 'external', 'https://example.com/old')
      .run()
    const before = await client
      .prepare('SELECT * FROM navigation_primary WHERE id=?')
      .bind(id)
      .all()
    const menu = await payload.create({
      collection: 'menus',
      data: {
        name: 'New location',
        items: [{ key: 'new', label: 'Current link', kind: 'custom', url: '/new' }],
      },
    })
    await payload.updateGlobal({
      slug: 'navigation',
      req: await req(),
      overrideAccess: false,
      data: { primaryMenu: menu.id, expectedUpdatedAt: global.updatedAt },
    })
    expect(
      (await payload.findGlobal({ slug: 'navigation', overrideAccess: false })).primary?.[0].label,
    ).toBe('Current link')
    expect(
      (await client.prepare('SELECT * FROM navigation_primary WHERE id=?').bind(id).all()).results,
    ).toEqual(before.results)
  })
})
