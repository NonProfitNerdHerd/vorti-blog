import type { Endpoint, PayloadRequest } from 'payload'
import { TenantRepository } from '../organizations/tenant-repository'
import type { FormPlatform } from './platform'
import { FORM_SITE } from './access'
import { formHostFeature } from './host-feature'
import { FormHTTPError } from './security'

/** A client host hint never substitutes for an active authenticated membership. */
export async function internalFormAuthority(req: PayloadRequest, platform: FormPlatform) {
  if (formHostFeature(req.headers) !== 'intranet') return null
  if (!req.user || req.user.collection !== 'users') throw new FormHTTPError('Sign in to use this internal form.', 401)
  const site = platform.resolveSite?.(req) || FORM_SITE
  const repository = new TenantRepository(platform.db, Number(req.user.id))
  const authority = await repository.require(site, 'intranet:read', { dependencies: ['forms'] })
  return { site, repository, authority }
}

export function protectInternalFormEndpoints(endpoints: Endpoint[], platform: FormPlatform): Endpoint[] {
  return endpoints.map(endpoint => ({ ...endpoint, handler: async req => {
    if (req.headers.get('x-vorti-form-host') !== 'intranet') return endpoint.handler(req)
    try {
      const selected = await internalFormAuthority(req, platform)
      if (!selected) return endpoint.handler(req)
      const response = await selected.repository.read({ site: selected.site, permission: 'intranet:read', dependencies: ['forms'], resource: `form-placement:${endpoint.path}` },
        async () => endpoint.handler(req))
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'private, no-store')
      headers.set('X-Robots-Tag', 'noindex, nofollow')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch (error) {
      const status = error instanceof FormHTTPError ? error.status : Number((error as { status?: number }).status) || 500
      return Response.json({ message: status === 401 ? 'Sign in to use this internal form.' : status >= 500 ? 'The form service is temporarily unavailable. Your answers have been retained.' : 'This internal form is unavailable.' },
        { status, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } })
    }
  } }))
}
