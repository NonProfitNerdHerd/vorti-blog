export interface AdminSite {
  id: string
  name: string
  parent_id: string | null
  archived?: number
  route_key?: string
}

function hierarchyLabel(site: AdminSite, sites: AdminSite[]): string {
  const names = [site.name],
    seen = new Set([site.id])
  let parent = site.parent_id
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const ancestor = sites.find((item) => item.id === parent)
    if (!ancestor) break
    names.unshift(ancestor.name)
    parent = ancestor.parent_id
  }
  return names.join(' → ')
}

export function siteLabel(site: AdminSite, sites: AdminSite[]): string {
  const label = hierarchyLabel(site, sites)
  return sites.some((item) => item.id !== site.id && hierarchyLabel(item, sites) === label)
    ? `${label} (${site.route_key || site.id})`
    : label
}

export function siteURL(href: string, site: string, admin: string, origin: string): string {
  const url = new URL(href, origin)
  if (
    url.origin !== origin ||
    !(url.pathname === admin || url.pathname.startsWith(admin + '/')) ||
    /\/(?:login|logout|forgot|reset)(?:\/|$)/.test(url.pathname)
  )
    return href
  if (!url.searchParams.has('site')) url.searchParams.set('site', site)
  if (
    url.searchParams.get('site') !== 'default' &&
    url.pathname === admin + '/globals/site-settings'
  )
    url.searchParams.set('tab', 'SubSites')
  if (url.searchParams.get('site') !== 'default' && url.pathname === admin + '/globals/navigation')
    url.pathname = admin + '/collections/menus'
  return url.pathname + url.search + url.hash
}

/** Use the same before-unload guards installed by Payload and custom editors, without leaving. */
export function hasUnsavedSiteChanges(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

/** The caller has already run the page's leave guard and, when needed, obtained
 * discard confirmation. A full navigation refreshes Payload's permission state
 * and releases editor-specific styles/caches before another tenant is shown. */
export function navigateAdminSite(url: string): void {
  window.addEventListener('beforeunload', (event) => event.stopImmediatePropagation(), {
    capture: true,
    once: true,
  })
  window.location.assign(url)
}
