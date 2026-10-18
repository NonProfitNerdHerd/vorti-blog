import type { Page, SiteSetting } from '@/payload-types'

/** Only publicly available pages can become site destinations. */
export function settingPage(value: number | Page | null | undefined): Page | null {
  return value && typeof value === 'object' && value._status === 'published' && value.slug
    ? value
    : null
}
export function postsPath(site: SiteSetting): string {
  const page = settingPage(site.blogPage)
  return page && !/^(admin|api|posts|forms|_next)$/.test(page.slug || '')
    ? `/${encodeURIComponent(page.slug!)}`
    : '/posts'
}
export function homePage(site: SiteSetting): Page | null {
  const page = settingPage(site.homepage)
  return page && !/^(admin|api|posts|forms|_next)$/.test(page.slug || '') ? page : null
}
export function privacyPath(site: SiteSetting): string | null {
  const page = settingPage(site.privacyPolicyPage)
  return site.showPrivacyPolicyLink && page
    ? homePage(site)?.id === page.id
      ? '/'
      : `/${encodeURIComponent(page.slug!)}`
    : null
}
