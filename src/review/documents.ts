import type { PayloadRequest, Where } from 'payload'

export const reviewDocuments = ['posts', 'pages', 'design-templates', 'site-templates'] as const
export type ReviewDocument = (typeof reviewDocuments)[number]
export const isAdministrator = (req: PayloadRequest) => req.user?.role === 'administrator'
export const relationID = (value: unknown): string =>
  String(value && typeof value === 'object' && 'id' in value ? value.id : (value ?? ''))

export function canReviewCollection(req: PayloadRequest, collection: string) {
  if (!req.user || !reviewDocuments.includes(collection as ReviewDocument)) return false
  return (
    ['posts', 'pages'].includes(collection) || ['administrator', 'designer'].includes(req.user.role)
  )
}

export async function reviewDocument(req: PayloadRequest, collection: string, id: string) {
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
  if (!req.user) return false
  if (isAdministrator(req)) return true // Administrators also retain orphaned review history.
  // Current document policies are collection-wide for signed-in users. Keep this
  // adapter aligned with those policies; never enumerate site-wide IDs into D1's
  // 100-parameter query limit. Deletion hooks maintain the server-owned marker.
  return {
    and: [
      {
        documentType: {
          in: reviewDocuments.filter((collection) => canReviewCollection(req, collection)),
        },
      },
      { documentDeleted: { not_equals: true } },
    ],
  }
}

export { taskDocumentLink } from './links'
