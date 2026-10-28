import { NextResponse, type NextRequest } from 'next/server'
import { PUBLIC_PREFIX_HEADER, PUBLIC_SITE_HEADER } from './organizations/public-site-headers'

/** The pinned Cloudflare adapter supports Edge middleware, not Node proxy.ts.
 * Authority and availability are checked in forms-worker before reaching this rewrite.
 * A framework rewrite preserves the browser's child URL during hydration and navigation. */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/admin' || request.nextUrl.pathname.startsWith('/admin/')) {
    const headers = new Headers(request.headers)
    // A site ID selects context only. Every repository still checks current authority.
    headers.delete('x-vorticause-site')
    headers.delete('x-vorticause-audience')
    let audience = request.nextUrl.searchParams.get('audience')
    let site = request.nextUrl.searchParams.get('site')
    const authentication = /^\/admin\/(?:login|logout|forgot|reset)(?:\/|$)/.test(
      request.nextUrl.pathname,
    )
    if ((!site || !audience) && !authentication) {
      try {
        const source = new URL(request.headers.get('referer') || '')
        if (
          source.origin === request.nextUrl.origin &&
          (source.pathname === '/admin' || source.pathname.startsWith('/admin/'))
        ) {
          site ||= source.searchParams.get('site')
          audience ||= source.searchParams.get('audience')
        }
      } catch {
        /* Direct visits use the authorized preference until the client pins the URL. */
      }
      if (audience && audience !== 'public' && audience !== 'intranet')
        return new NextResponse('Invalid publishing area', { status: 400 })
      if (((site && !request.nextUrl.searchParams.has('site')) || (audience && !request.nextUrl.searchParams.has('audience'))) && request.method === 'GET') {
        const destination = request.nextUrl.clone()
        if (site) destination.searchParams.set('site', site)
        if (audience === 'public' || audience === 'intranet') destination.searchParams.set('audience', audience)
        if (site !== 'default' && destination.pathname === '/admin/globals/site-settings')
          destination.searchParams.set('tab', 'SubSites')
        if (site !== 'default' && destination.pathname === '/admin/globals/navigation')
          destination.pathname = '/admin/collections/menus'
        return NextResponse.redirect(destination)
      }
    }
    if (audience && audience !== 'public' && audience !== 'intranet')
      return new NextResponse('Invalid publishing area', { status: 400 })
    if (audience) headers.set('x-vorticause-audience', audience)
    if (site) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(site))
        return new NextResponse('Invalid site', { status: 400 })
      headers.set('x-vorticause-site', site)
    }
    return NextResponse.next({ request: { headers } })
  }
  const prefix = request.headers.get(PUBLIC_PREFIX_HEADER)
  if (
    !prefix ||
    !request.headers.get(PUBLIC_SITE_HEADER) ||
    !/^\/sites\/[a-zA-Z0-9_-]{1,80}$/.test(prefix) ||
    !(request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(prefix + '/'))
  )
    return new NextResponse('Not found', { status: 404 })
  const destination = request.nextUrl.clone()
  destination.pathname = request.nextUrl.pathname.slice(prefix.length) || '/'
  return NextResponse.rewrite(destination, { request: { headers: new Headers(request.headers) } })
}
export const config = { matcher: ['/sites/:siteKey/:path*', '/admin/:path*'] }
