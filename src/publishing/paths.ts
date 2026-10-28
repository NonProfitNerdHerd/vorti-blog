export function internalPagePath(page: { slug?: string | null; breadcrumbs?: Array<{ url?: string | null }> | null }) {
  const path = page.breadcrumbs?.at(-1)?.url
  if (path && /^\/(?!\/)[^\s\\?#]*$/u.test(path) && !/%(?:2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(path)) return path
  return `/${encodeURIComponent(page.slug || '')}`
}
