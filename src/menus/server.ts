import { publicWebsite } from '../organizations/public-website'
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
import { CMS_MENU_RENDER, cmsSiteContext } from '../organizations/cms-scope'
import { rendererRequest, type RenderScope } from '../lib/render-scope'
import { scopedSettingsForAuthorizedSite } from '../organizations/scoped-settings'
import { TenantRepository } from '../organizations/tenant-repository'
import { internalPagePath } from '../publishing/paths'

/** Deliberately anonymous: an editor's session must never hydrate private destinations into public HTML. */
export async function resolveMenu(
  payload: Payload,
  id: string | number,
  siteID?: string,
  context: RenderScope = {},
): Promise<ResolvedMenu | null> {
  if(!siteID){try {siteID=(await (await import('next/headers')).headers()).get('x-vorticause-public-site') || 'default'}catch{siteID='default'}}
  if (!/^[1-9][0-9]*$/.test(String(id))) return null
  const internal = context.audience === 'intranet'
  const req = await rendererRequest(payload, { ...context, site: siteID })
  Object.assign(req.context, { menuOperation: internal ? 'internal-render' : 'public-render', [CMS_MENU_RENDER]: true })
  let menu
  try {
    menu = await payload.findByID({
      collection: 'menus',
      id: Number(id),
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null
    throw error
  }
  const items = (menu.items || []) as MenuItem[]
  if (validateMenuItems(items) !== true) return null
  const database = (payload.db as unknown as { client: D1Database }).client
  const authority = internal && context.user ? await new TenantRepository(database, Number(context.user.id)).require(siteID, 'intranet:read') : null
  const scoped = authority ? await scopedSettingsForAuthorizedSite(database, siteID, authority.tenant) : null
  const site = scoped ? { ...scoped.site.settings, homepage: scoped.site.settings.intranetHomepage } : siteID === 'default' ? await payload.findGlobal({
    slug: 'site-settings',
    depth: 1,
    overrideAccess: false,
    user: null,
  }) : JSON.parse((await publicWebsite((payload.db as unknown as {client:D1Database}).client,siteID))?.presentation || '{}')
  const destinations = new Map<string, string>()
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
        collection, req,
        where: {
          and: [{ id: { in: ids.slice(index, index + 75) } }, { _status: { equals: 'published' } }],
        },
        depth: 0,
        limit: 75,
        draft: false,
        overrideAccess: false,
      })
      for (const doc of result.docs) {
        if (!doc.slug) continue
        let href = `/${encodeURIComponent(doc.slug)}`
        if (kind === 'post') {
          href = documentURL(doc)
        } else if (homePage(site)?.id === doc.id) href = '/'
        else if (internal) href = internalPagePath(doc)
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
