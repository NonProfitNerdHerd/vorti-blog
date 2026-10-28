import type { PayloadRequest, Where } from 'payload'
import { authorityClaim } from '../organizations/claims'

/** Document-review tasks require the linked document, including list/count
 * queries. Hiding only the document label after fetching a task is insufficient:
 * task titles and discussions can themselves describe restricted content.
 */
export function publishingReviewWhere(req: PayloadRequest, prefix = ''): Where {
  const claim = authorityClaim(req.user), permissions = claim?.permissions || []
  const types = ['posts', 'pages', 'site-templates']
  const conditions: Where[] = [
    { [`${prefix}documentType`]: { exists: false } },
    { [`${prefix}documentType`]: { not_in: types } },
  ]
  if (!claim || !req.user) return { or: conditions }
  const join = `${prefix}publishingDocumentReadability`
  const publicTypes = types.filter(type => {
    const publicPermission = type === 'site-templates' ? 'administration:templates' : `${type}:read-history`
    const allowed = claim.permissions ? permissions.includes(publicPermission as typeof permissions[number])
      : claim.allowed.content?.includes(type === 'site-templates' ? 'configure' : 'read')
    return allowed && (!claim.featureSites || type === 'site-templates' || claim.featureSites[type]?.includes(claim.site))
  })
  // Filter the joined authorization view instead of repeating task.* paths for
  // each content type. Payload creates a parent-table join per such path; nested
  // notification/count queries otherwise exceed SQLite's 64-table join limit.
  const scope = [{ [`${join}.site`]: { equals: claim.site } }, { [`${join}.validStructure`]: { equals: true } }]
  if (publicTypes.length) conditions.push({ and: [...scope, { [`${join}.actor`]: { equals: 0 } },
    { [`${join}.audience`]: { equals: 'public' } }, { [`${join}.sourceCollection`]: { in: publicTypes } }] })
  const internalTypes = types.filter(type => type !== 'site-templates' || permissions.includes('administration:templates'))
  if (permissions.includes('intranet:read') && permissions.includes('intranet:read-history') &&
    (!claim.featureSites || claim.featureSites.intranet?.includes(claim.site))) conditions.push({ and: [...scope,
      { [`${join}.actor`]: { equals: Number(req.user.id) } }, { [`${join}.audience`]: { equals: 'intranet' } },
      { [`${join}.sourceCollection`]: { in: internalTypes } }, ...(claim.tenantAdministrator ? [] : [{ [`${join}.ordinaryAccess`]: { equals: true } }]),
    ] })
  return { or: conditions }
}
