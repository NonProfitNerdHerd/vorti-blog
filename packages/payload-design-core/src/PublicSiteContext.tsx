'use client'
import {
  createContext,
  useCallback,
  useContext,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react'

const PublicSiteContext = createContext({ prefix: '', preview: false, audience: 'public' as 'public' | 'intranet' })
export function PublicSiteProvider({
  prefix,
  preview = false,
  audience = 'public',
  children,
}: {
  prefix: string
  preview?: boolean
  audience?: 'public' | 'intranet'
  children: ReactNode
}) {
  return (
    <PublicSiteContext.Provider value={{ prefix, preview, audience }}>{children}</PublicSiteContext.Provider>
  )
}
export function sitePath(prefix: string, path: string, audience: 'public' | 'intranet' = 'public') {
  if (audience === 'intranet' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/sites/') &&
      !/^\/(?:api|admin|wiki|intranet|forms|_next|forms-assets)(?:\/|$)/.test(path)) {
    path = path === '/' ? '/intranet' : /^\/(?:posts|pages|resources)(?:\/|$)/.test(path) ? '/intranet' + path : '/intranet/pages' + path
  }
  if (
    !prefix ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.startsWith('/sites/') ||
    /^\/(?:_next|forms-assets)(?:\/|$)/.test(path)
  )
    return path
  return prefix + path
}
export function usePublicSitePath() {
  const { prefix, preview, audience } = useContext(PublicSiteContext)
  return useCallback(
    (path: string) => {
      const result = sitePath(prefix, path, audience)
      if (!preview || !result.startsWith(prefix + '/') || result.includes('preview=1'))
        return result
      const [url, hash] = result.split('#')
      return url + (url.includes('?') ? '&' : '?') + 'preview=1' + (hash ? '#' + hash : '')
    },
    [prefix, preview, audience],
  )
}
export function SiteAnchor({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const path = usePublicSitePath()
  return <a {...props} href={href ? path(href) : href} />
}
export function publicRequestHeaders(url: string, audience: 'public' | 'intranet', pathname: string, input?: HeadersInit): HeadersInit | undefined {
  const api = url.replace(/^\/sites\/[^/]+(?=\/|$)/, '')
  const form = /^\/api\/forms-(?:runtime|placement|surveys|payments|embed)(?:\/|$)/.test(api)
  const location = pathname.replace(/^\/sites\/[^/]+(?=\/|$)/, '') || '/'
  const host = !form ? undefined : audience === 'intranet' || /^\/intranet(?:\/|$)/.test(location) ? 'intranet'
    : /^\/posts(?:\/|$)/.test(location) ? 'posts' : /^\/wiki(?:\/|$)/.test(location) ? 'wiki'
      : /^\/(?:forms|api|admin)(?:\/|$)/.test(location) ? undefined : 'pages'
  if (audience === 'public' && !host) return input
  const headers = new Headers(input)
  if (audience === 'intranet') headers.set('x-vorticause-audience', 'intranet')
  if (host) headers.set('x-vorti-form-host', host)
  return headers
}
export function usePublicRequestHeaders() {
  const { audience } = useContext(PublicSiteContext)
  return useCallback((url: string, input?: HeadersInit) => publicRequestHeaders(url, audience, typeof window === 'undefined' ? '/' : window.location.pathname, input), [audience])
}
export function usePublicFetch() {
  const path = usePublicSitePath()
  const requestHeaders = usePublicRequestHeaders()
  return useCallback((url: string, options?: RequestInit) => {
    const headers = requestHeaders(url, options?.headers)
    return fetch(path(url), headers === options?.headers ? options : { ...options, headers })
  }, [path, requestHeaders])
}
