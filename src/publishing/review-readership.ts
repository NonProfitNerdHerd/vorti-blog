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
  for (const type of types) {
    const publicPermission = type === 'site-templates' ? 'administration:templates' : `${type}:read-history`
    if (permissions.includes(publicPermission as typeof permissions[number])) conditions.push({ and: [
      { [`${prefix}documentType`]: { equals: type } },
      { [`${prefix}documentSite`]: { equals: claim.site } },
      { [`${join}.actor`]: { equals: 0 } }, { [`${join}.audience`]: { equals: 'public' } }, { [`${join}.validStructure`]: { equals: true } },
      ...(claim.featureSites && type !== 'site-templates' ? [{ [`${prefix}documentSite`]: { in: claim.featureSites[type as 'posts' | 'pages'] || [] } }] : []),
    ] })
    if (permissions.includes('intranet:read') && permissions.includes('intranet:read-history') && (type !== 'site-templates' || permissions.includes('administration:templates'))) conditions.push({ and: [
      { [`${prefix}documentType`]: { equals: type } },
      { [`${prefix}documentSite`]: { equals: claim.site } },
      { [`${join}.actor`]: { equals: Number(req.user.id) } }, { [`${join}.audience`]: { equals: 'intranet' } }, { [`${join}.validStructure`]: { equals: true } },
      ...(claim.tenantAdministrator ? [] : [{ [`${join}.ordinaryAccess`]: { equals: true } }]),
      ...(claim.featureSites ? [{ [`${prefix}documentSite`]: { in: claim.featureSites.intranet || [] } }] : []),
    ] })
  }
  return { or: conditions }
}
