import type { PayloadRequest, Where } from 'payload'
import { authorityClaim } from './claims'

/** Native joins target one indexed capability key, keeping Inbox queries below D1's join limit. */
export function workspaceGrantWhere(
  req: PayloadRequest,
  permission: 'read' | 'edit' | 'comment' | 'owner',
  prefix = '',
  join = 'siteAccessGrants',
): Where {
  if (!req.user) return { id: { equals: -1 } }
  const claim = authorityClaim(req.user),
    keys = [`personal:${req.user.id}`]
  if (claim?.allowed.workspace?.includes(permission === 'read' ? 'read' : 'edit')) {
    keys.push(`site:${claim.site}:user:${req.user.id}`)
    if (permission === 'read') keys.push(`site:${claim.site}:team`)
  }
  return { [`${prefix}${join}.${permission}Key`]: { in: keys } }
}
