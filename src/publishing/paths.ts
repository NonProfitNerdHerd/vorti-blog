export function internalPagePath(page: { slug?: string | null; breadcrumbs?: Array<{ url?: string | null }> | null }) {
  return page.breadcrumbs?.at(-1)?.url || `/${encodeURIComponent(page.slug || '')}`
}
