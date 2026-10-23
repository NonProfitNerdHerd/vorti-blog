import { NextResponse, type NextRequest } from 'next/server'
import { PUBLIC_PREFIX_HEADER, PUBLIC_SITE_HEADER } from './organizations/public-site-headers'

/** The pinned Cloudflare adapter supports Edge middleware, not Node proxy.ts.
 * Authority and availability are checked in forms-worker before reaching this rewrite.
 * A framework rewrite preserves the browser's child URL during hydration and navigation. */
export function middleware(request: NextRequest) {
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
export const config = { matcher: ['/sites/:siteKey/:path*'] }
