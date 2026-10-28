import { APIError, type Payload } from 'payload'
import type { RenderScope } from '../lib/render-scope'
import { PUBLIC_SITE_HEADER } from '../organizations/public-site-headers'

export async function publishingRequestScope(payload: Payload, request: { headers: Headers }, draft = false): Promise<RenderScope> {
  const hint = request.headers.get('x-vorticause-audience')
  if (hint && hint !== 'public' && hint !== 'intranet') throw new APIError('Choose a valid publishing area.', 400)
  const internal = hint === 'intranet'
  const site = request.headers.get(PUBLIC_SITE_HEADER) || request.headers.get('x-vorticause-site') || 'default'
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(site)) throw new APIError('Choose a valid site.', 400)
  const user = draft || internal ? (await payload.auth({ headers: request.headers })).user : undefined
  if ((draft || internal) && !user) throw new APIError('Content unavailable.', internal ? 404 : 401)
  return { site, audience: internal ? 'intranet' : 'public', draft, user }
}
