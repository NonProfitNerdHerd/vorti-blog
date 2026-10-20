import type { Payload } from 'payload'
import {
  documentURL,
  safeMenuURL,
  validateMenuItems,
  type MenuItem,
  type MenuLink,
  type ResolvedMenu,
} from '@design-system/payload-design-core'
import { homePage } from '../lib/site-pages'

/** Deliberately anonymous: an editor's session must never hydrate private destinations into public HTML. */
export async function resolveMenu(
  payload: Payload,
  id: string | number,
): Promise<ResolvedMenu | null> {
  if (!/^[1-9][0-9]*$/.test(String(id))) return null
  let menu
  try {
    menu = await payload.findByID({
      collection: 'menus',
      id: Number(id),
      depth: 0,
      overrideAccess: true,
    })
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null
    throw error
  }
  const items = (menu.items || []) as MenuItem[]
  if (validateMenuItems(items) !== true) return null
  const site = await payload.findGlobal({
    slug: 'site-settings',
    depth: 1,
    overrideAccess: false,
    user: null,
  })
  const ref = (value: unknown): number =>
    Number(value && typeof value === 'object' && 'id' in value ? value.id : value)
  const destinations = new Map<string, string>()
  const types = new Map<number, Promise<unknown>>()
  for (const [kind, collection] of [
    ['page', 'pages'],
    ['post', 'posts'],
  ] as const) {
    const ids = [
      ...new Set(
        items.filter((item) => item.kind === kind && item.target).map((item) => item.target!),
      ),
    ]
    // Bound SQLite parameters and avoid one query per link.
    for (let index = 0; index < ids.length; index += 75) {
      const result = await payload.find({
        collection,
        where: {
          and: [{ id: { in: ids.slice(index, index + 75) } }, { _status: { equals: 'published' } }],
        },
        depth: 0,
        limit: 75,
        draft: false,
        overrideAccess: false,
        user: null,
      })
      for (const doc of result.docs) {
        if (!doc.slug) continue
        let href = `/${encodeURIComponent(doc.slug)}`
        if (kind === 'post') {
          const post = doc as { postType?: number | { id: number }; slug: string }
          let type
          {
            const typeID = ref(post.postType) || 0
            if (!types.has(typeID))
              types.set(
                typeID,
                payload
                  .find({
                    collection: 'post-types',
                    where: {
                      and: [
                        typeID ? { id: { equals: typeID } } : { key: { equals: 'post' } },
                        { _status: { equals: 'published' } },
                      ],
                    },
                    depth: 0,
                    limit: 1,
                    draft: false,
                    overrideAccess: false,
                    user: null,
                  })
                  .then((found) => found.docs[0]),
              )
            type = await types.get(typeID)
            if (!type && post.postType) continue
          }
          href = documentURL({ slug: doc.slug, postType: type })
        } else if (homePage(site)?.id === doc.id) href = '/'
        destinations.set(`${kind}:${doc.id}`, href)
      }
    }
  }
  const build = (parent: string | null): MenuLink[] =>
    items
      .filter((item) => (item.parent || null) === parent && item.enabled !== false)
      .flatMap((item) => {
        const href =
          item.kind === 'custom'
            ? safeMenuURL(item.url)
              ? item.url
              : null
            : destinations.get(`${item.kind}:${item.target}`)
        return href
          ? [
              {
                key: item.key,
                label: item.label,
                href,
                newTab: !!item.newTab,
                children: build(item.key),
              },
            ]
          : []
      })
  return { id: menu.id, name: menu.name, items: build(null) }
}

export function legacyMenu(items: MenuLink[]): unknown[] {
  return items.map((item) => ({
    id: item.key,
    label: item.label,
    linkType: 'external',
    url: item.href,
    enabled: true,
    newTab: item.newTab,
    children: legacyMenu(item.children),
  }))
}
