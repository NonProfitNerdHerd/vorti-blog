import type { PayloadRequest, Where } from 'payload'
import { taskWhere } from './workspace-access'
import { authorityClaim } from '../organizations/claims'
import { claimRequest } from '../organizations/identity-authority'

export const reviewDocuments = ['posts', 'pages', 'design-templates', 'site-templates'] as const
export type ReviewDocument = (typeof reviewDocuments)[number]
export const isAdministrator = (req: PayloadRequest) => authorityClaim(req.user)?.operator === true
export const relationID = (value: unknown): string =>
  String(value && typeof value === 'object' && 'id' in value ? value.id : (value ?? ''))

export function canReviewCollection(req: PayloadRequest, collection: string) {
  if (!req.user || !reviewDocuments.includes(collection as ReviewDocument)) return false
  const claim = authorityClaim(req.user)
  // Review records include draft titles and discussion. Published-content-only
  // access must not expose that private review metadata.
  if (claim?.permissions) {
    if (collection === 'posts' || collection === 'pages') return claim.permissions.includes(`${collection}:read-history`) || claim.permissions.includes('intranet:read-history')
    return claim.permissions.includes(collection === 'site-templates' ? 'administration:templates' : 'administration:designs')
  }
  const content = claim?.allowed.content
  return !!content?.includes(['posts', 'pages'].includes(collection) ? 'read' : 'configure')
}

export async function reviewDocument(req: PayloadRequest, collection: string, id: string) {
  await claimRequest(req)
  if (!canReviewCollection(req, collection)) return null
  try {
    return await req.payload.findByID({
      collection: collection as ReviewDocument,
      id,
      req,
      overrideAccess: false,
      depth: 0,
      draft: true,
    })
  } catch (error) {
    if ([403, 404].includes((error as { status?: number }).status ?? 0)) return null
    throw error
  }
}

/** Query-level access: inaccessible documents never enter list results or counts. */
export async function reviewAccess(req: PayloadRequest): Promise<boolean | Where> {
  return taskWhere(req)
}

export { taskDocumentLink } from './links'
