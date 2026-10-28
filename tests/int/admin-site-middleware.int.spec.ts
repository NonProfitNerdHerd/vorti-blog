import { expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../src/middleware'

it('pins native admin navigation to the originating page rather than a mutable preference', () => {
  const response = middleware(
    new NextRequest('https://app.test/admin/collections/posts', {
      headers: { referer: 'https://app.test/admin?site=child' },
    }),
  )
  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe(
    'https://app.test/admin/collections/posts?site=child',
  )
})
it('does not accept a foreign origin as an admin context source', () => {
  const response = middleware(
    new NextRequest('https://app.test/admin', {
      headers: { referer: 'https://foreign.test/admin?site=other', 'x-vorticause-site': 'forged' },
    }),
  )
  expect(response.headers.get('location')).toBeNull()
  expect(response.headers.get('x-middleware-request-x-vorticause-site')).toBeNull()
})
it('preserves explicit URL context over another page or incoming header', () => {
  const response = middleware(
    new NextRequest('https://app.test/admin?site=original', {
      headers: { referer: 'https://app.test/admin?site=other', 'x-vorticause-site': 'forged' },
    }),
  )
  expect(response.headers.get('x-middleware-request-x-vorticause-site')).toBe('original')
})
it('binds native server actions without redirecting or losing their body', () => {
  const response = middleware(
    new NextRequest('https://app.test/admin/collections/posts/create', {
      method: 'POST',
      headers: { referer: 'https://app.test/admin/collections/posts/create?site=original' },
    }),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('x-middleware-request-x-vorticause-site')).toBe('original')
})
it('routes child settings to their scoped editor and leaves sign-in URLs alone', () => {
  const response = middleware(
    new NextRequest('https://app.test/admin/globals/site-settings', {
      headers: { referer: 'https://app.test/admin?site=child' },
    }),
  )
  expect(response.headers.get('location')).toBe(
    'https://app.test/admin/globals/site-settings?site=child&tab=SubSites',
  )
  const login = middleware(
    new NextRequest('https://app.test/admin/login', {
      headers: { referer: 'https://app.test/admin?site=child' },
    }),
  )
  expect(login.headers.get('location')).toBeNull()
})
it('rejects invalid explicit site IDs', () => {
  expect(middleware(new NextRequest('https://app.test/admin?site=bad%2Fsite')).status).toBe(400)
})

it('keeps the publishing area when native navigation omits it, while respecting explicit area switches', () => {
  const response = middleware(new NextRequest('https://app.test/admin/collections/pages/create?site=child', {
    headers: { referer: 'https://app.test/admin/collections/pages?site=child&audience=intranet' },
  }))
  expect(response.headers.get('location')).toBe('https://app.test/admin/collections/pages/create?site=child&audience=intranet')
  const explicit = middleware(new NextRequest('https://app.test/admin/collections/pages?site=child&audience=public', {
    headers: { referer: 'https://app.test/admin/collections/pages?site=child&audience=intranet', 'x-vorticause-audience': 'intranet' },
  }))
  expect(explicit.headers.get('location')).toBeNull()
  expect(explicit.headers.get('x-middleware-request-x-vorticause-audience')).toBe('public')
  const action = middleware(new NextRequest('https://app.test/admin/collections/pages/create?site=child', {
    method: 'POST', headers: { referer: 'https://app.test/admin/collections/pages?site=child&audience=intranet' },
  }))
  expect(action.headers.get('x-middleware-request-x-vorticause-audience')).toBe('intranet')
})

it('rejects invalid publishing area hints without a redirect loop and ignores foreign hints', () => {
  expect(middleware(new NextRequest('https://app.test/admin?site=default', {
    headers: { referer: 'https://app.test/admin?audience=unknown' },
  })).status).toBe(400)
  const foreign = middleware(new NextRequest('https://app.test/admin?site=default', {
    headers: { referer: 'https://foreign.test/admin?audience=intranet', 'x-vorticause-audience': 'intranet' },
  }))
  expect(foreign.headers.get('x-middleware-request-x-vorticause-audience')).toBeNull()
})
