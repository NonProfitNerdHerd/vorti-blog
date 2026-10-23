export const PUBLIC_SITE_HEADER = 'x-vorticause-public-site'
export const PUBLIC_PREFIX_HEADER = 'x-vorticause-public-prefix'
export const PUBLIC_PREVIEW_HEADER = 'x-vorticause-website-preview'

/** Public Forms URLs select a website; the staff preference selects new admin editors. */
export function publicFormsSite(url: string | undefined, headers: Headers): string | undefined {
  const child = headers.get(PUBLIC_SITE_HEADER)
  if (child) return child
  if (!url) return undefined
  const path = new URL(url, 'http://local.invalid').pathname
  return /^\/api\/(forms-runtime|forms-embed|forms-surveys|forms-payments|forms-placement)(\/|$)/.test(
    path,
  )
    ? 'default'
    : undefined
}
