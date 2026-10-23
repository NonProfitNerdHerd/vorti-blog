import { rendererRequest, type RenderScope } from './render-scope'
import type { Payload, PayloadRequest, Where } from 'payload'
import { mediaURL } from './media'
import { readCategoriesEnabled } from './system-settings'
import {documentURL} from '@design-system/payload-design-core/content'
/** Only publicly accessible document data crosses the block rendering boundary. */
export async function queryBlockListing(
  payload: Payload,
  props: Record<string, unknown>,
  page = 1,
  context: RenderScope = {},
) {
  const req=await rendererRequest(payload,context)
  const collection = props.collection === 'pages' ? 'pages' : 'posts'
  const categoriesEnabled = await readCategoriesEnabled(payload)
  const limit = Math.min(50, Math.max(1, Number(props.limit) || 6))
  const draft = !!context.draft && !!context.user
  const where: Where[] = draft ? [] : [{ _status: { equals: 'published' } }]
  const ids = String(props.ids ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const categories = String(props.categories ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (ids.length) where.push({ id: { in: ids } })
  if (categories.length && collection === 'posts') where.push({ categories: { in: categories } })
  const sort = ['-publishedAt', 'publishedAt', 'title', '-updatedAt'].includes(String(props.sort))
    ? String(props.sort)
    : '-publishedAt'
  const response = await payload.find({req,
    collection,
    user: context.user,
    draft,
    overrideAccess: false,
    depth: 1,
    page: Math.max(1, Math.min(10000, page)),
    limit,
    sort,
    where: { and: where },
  })
  return {
    page: response.page ?? 1,
    totalPages: response.totalPages,
    results: response.docs.map((doc) => {
      const item = doc as unknown as Record<string, unknown>
      return {
        title: String(item.title ?? ''),
        url: collection === 'posts' ? documentURL(item) : `/${item.slug}`,
        excerpt: String(item.excerpt ?? ''),
        publishedAt: String(item.publishedAt ?? ''),
        image:
          item.featuredImage && typeof item.featuredImage === 'object'
            ? (mediaURL(item.featuredImage as never) ?? undefined)
            : undefined,
        taxonomy: categoriesEnabled && Array.isArray(item.categories)
          ? item.categories
              .map((category) =>
                typeof category === 'object' && category
                  ? String(category.title ?? category.name ?? '')
                  : '',
              )
              .filter(Boolean)
              .join(', ')
          : '',
      }
    }),
  }
}
