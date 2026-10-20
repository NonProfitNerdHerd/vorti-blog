import type { Navigation, Page } from '../payload-types'
import { safeMenuURL, type MenuLink } from '@design-system/payload-design-core/content'
export function legacyMenuLinks(items: Navigation['primary']): MenuLink[] {
  return (items || []).flatMap((item) => {
    if (item.enabled === false) return []
    const page = typeof item.page === 'object' ? (item.page as Page) : null
    const href =
      item.linkType === 'internal'
        ? page?._status === 'published' && page.slug
          ? `/${page.slug}`
          : null
        : safeMenuURL(item.url)
          ? item.url
          : null
    return href
      ? [
          {
            key: item.id || item.label,
            href,
            label: item.label,
            newTab: !!item.newTab,
            children: legacyMenuLinks(item.children),
          },
        ]
      : []
  })
}
