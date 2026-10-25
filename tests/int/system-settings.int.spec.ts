import { describe, expect, it, vi } from 'vitest'
import { Posts } from '@/collections/Posts'
import { Categories } from '@/collections/Categories'
import {
  categoriesEnabledForRequest,
  sameCategories,
  protectCategoryValues,
} from '@/lib/system-settings'
import { queryView } from '@/content-framework/query'
import { queryBlockListing } from '@/lib/block-listings'
import { defaultView } from '@design-system/payload-design-core'

function fixture(enabled = false) {
  const payload = {
    config: {
      i18n: {
        fallbackLanguage: 'en',
        supportedLanguages: { en: { translations: {}, dateFNSKey: 'en-US' } },
      },
      admin: { user: 'users' },
      serverURL: 'http://localhost',
      routes: { api: '/api' },
    },
    findGlobal: vi.fn().mockResolvedValue({ categoriesEnabled: enabled }),
    find: vi.fn().mockImplementation(async ({ collection }: { collection: string }) => ({
      docs:
        collection === 'posts'
          ? [
              {
                id: 4,
                title: 'Saved listing',
                slug: 'saved-listing',
                categories: [{ id: 1, name: 'Original category' }],
                tags: [{ id: 2, name: 'Kept tag' }],
              },
            ]
          : [{ id: 2, name: 'Kept tag' }],
      page: 1,
      totalPages: 1,
      totalDocs: 1,
    })),
  }
  return { payload, req: { payload, context: {}, user: { id: 7 } } }
}
describe('Categories system setting', () => {
  it('also protects category relationships in structured post and template fields', async () => {
    const { req } = fixture()
    const fields = [
      { id: 'topic', relationTo: 'categories' },
      { id: 'tag', relationTo: 'tags' },
    ]
    await expect(
      protectCategoryValues(req as never, fields, { topic: 2 }, { topic: 1 }, 'templateValues'),
    ).rejects.toThrow()
    await expect(
      protectCategoryValues(
        req as never,
        fields,
        { topic: 1, tag: 4 },
        { topic: { id: 1 } },
        'templateValues',
      ),
    ).resolves.toBeUndefined()
  })
  it('preserves populated or unpopulated category assignments and caches access checks per request', async () => {
    expect(sameCategories([1, { id: 2 }], [2, 1])).toBe(true)
    const { req, payload } = fixture()
    expect(await categoriesEnabledForRequest(req as never)).toBe(false)
    expect(await categoriesEnabledForRequest(req as never)).toBe(false)
    expect(payload.findGlobal).toHaveBeenCalledTimes(1)
  })
  it('rejects assignment changes while off and allows unrelated or identical saves', async () => {
    const { req } = fixture()
    const validate = Posts.hooks!.beforeValidate![0]
    await expect(
      validate({ data: { categories: [2] }, originalDoc: { categories: [1] }, req } as never),
    ).rejects.toMatchObject({
      data: {
        errors: [{ path: 'categories', message: 'Categories are disabled in Site Settings.' }],
      },
    })
    await expect(
      validate({ data: { categories: [] }, originalDoc: { categories: [1] }, req } as never),
    ).rejects.toThrow()
    await expect(
      validate({
        data: { title: 'Unrelated change' },
        originalDoc: { categories: [1] },
        req,
      } as never),
    ).resolves.toEqual({ title: 'Unrelated change' })
    await expect(
      validate({
        data: { categories: [1] },
        originalDoc: { categories: [{ id: 1 }] },
        req,
      } as never),
    ).resolves.toEqual({ categories: [1] })
    const active = fixture(true)
    await expect(
      validate({
        data: { categories: [2] },
        originalDoc: { categories: [1] },
        req: active.req,
      } as never),
    ).resolves.toEqual({ categories: [2] })
  })
  it('blocks category create, update and delete access while off', async () => {
    for (const operation of ['create', 'update', 'delete'] as const) {
      expect(await Categories.access![operation]!({ req: fixture().req } as never)).toBe(false)
      expect(await Categories.access![operation]!({ req: fixture(true).req } as never)).toBe(true)
    }
  })
  it('keeps saved category rules, ignores URL category filters and hides categories without hiding tags', async () => {
    const { payload } = fixture()
    const config = {
      ...defaultView,
      filters: true,
      query: {
        source: 'posts' as const,
        rules: [{ field: 'categories' as const, operator: 'any' as const, values: ['1'] }],
      },
    }
    const result = await queryView(
      payload as never,
      config,
      new URLSearchParams('categories=99&tags=2'),
    )
    const where = JSON.stringify(payload.find.mock.calls[0][0].where)
    expect(where).toContain('"categories":{"in":["1"]}')
    expect(where).not.toContain('99')
    expect(where).toContain('"tags":{"in":["2"]}')
    expect(result.items[0].categories).toEqual([])
    expect(result.items[0].tags).toEqual([{ id: '2', name: 'Kept tag' }])
    expect(result.facets?.categories).toEqual([])
    expect(result.facets?.tags).toHaveLength(1)
    expect(result.categoriesEnabled).toBe(false)
  })
  it('retains block listing category constraints but suppresses displayed taxonomy while off', async () => {
    const { payload } = fixture()
    const result = await queryBlockListing(payload as never, { categories: '1' })
    expect(payload.find.mock.calls[0][0].where.and).toContainEqual({ categories: { in: ['1'] } })
    expect(result.results[0].taxonomy).toBe('')
  })
})
