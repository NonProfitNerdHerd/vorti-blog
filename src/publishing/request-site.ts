import { APIError } from 'payload'
import { PUBLIC_SITE_HEADER } from '../organizations/public-site-headers'

/** The Worker strips incoming public-site headers and supplies its resolved site.
 * A prefixed URL cannot be retargeted by a query string or an editor preference.
 * Central admin endpoints may still explicitly select an authorized site.
 */
export function publishingRequestSite(url: string, headers: Headers): string {
  const routed = headers.get(PUBLIC_SITE_HEADER)
  const requested = new URL(url).searchParams.get('site') || headers.get('x-vorticause-site')
  if (routed && requested && routed !== requested) throw new APIError('Site does not match this address.', 400)
  const site = routed || requested || 'default'
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(site)) throw new APIError('Choose a valid site.', 400)
  return site
}
