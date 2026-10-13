import { APIError, ValidationError, type CollectionBeforeChangeHook, type CollectionAfterChangeHook, type CollectionSlug } from 'payload'
import { mayTransition, type EntryWorkflow } from '@design-system/payload-design-core/forms'
import { canForm, FORM_INTERNAL, FORM_SITE, internalRequest, type FormsUser } from './access'
import { BookingStore } from './booking'
import type { FormPlatform } from './platform'

const reviewFields = ['workflowStatus', 'read', 'starred', 'spam', 'archived', 'reviewer', 'notes', 'tags'] as const
const relationshipID = (value: unknown): unknown => value && typeof value === 'object' && 'id' in value ? value.id : value
const invalid = (path: string, message: string): never => { throw new ValidationError({ errors: [{ path, message }] }) }

/** Review permissions are checked even for Local API callers using overrideAccess. */
export const validateEntryReview: CollectionBeforeChangeHook = async ({ data, originalDoc, req, operation }) => {
  if (internalRequest(req) || operation !== 'update') return data
  const site = String(originalDoc.site || FORM_SITE)
  if (!canForm(req.user as FormsUser, 'entries', site)) throw new APIError('You cannot review entries in this site.', 403)
  if (data.workflowStatus && data.workflowStatus !== originalDoc.workflowStatus) {
    let workflow: EntryWorkflow | undefined
    if (originalDoc.revision) {
      // This is a server-only lookup after entry permission enforcement, scoped to the historical form and site.
      const result = await req.payload.find({ collection: 'form-revisions' as CollectionSlug, overrideAccess: true, req, depth: 0, limit: 1,
        where: { and: [{ revision: { equals: originalDoc.revision } }, { site: { equals: site } }, { form: { equals: relationshipID(originalDoc.form) } }] },
      })
      const revision = result.docs[0] as unknown as { definition?: { workflow?: EntryWorkflow } } | undefined
      if (!revision) invalid('workflowStatus', 'The original form revision is unavailable. Restore it before changing this entry’s status.')
      workflow = revision.definition?.workflow
    }
    if (!mayTransition(originalDoc.workflowStatus || 'received', data.workflowStatus, (req.user as FormsUser)?.role || '', workflow)) {
      invalid('workflowStatus', `Your role cannot move this entry from ${originalDoc.workflowStatus || 'received'} to ${data.workflowStatus}. Choose an allowed transition.`)
    }
  }
  if (data.reviewer && relationshipID(data.reviewer) !== relationshipID(originalDoc.reviewer)) {
    let reviewer: FormsUser | undefined
    try {
      reviewer = await req.payload.findByID({ collection: 'users', id: relationshipID(data.reviewer) as string | number, overrideAccess: true, req, depth: 0 }) as FormsUser
    } catch { invalid('reviewer', 'Choose an existing reviewer with entry access in this site.') }
    if (!canForm(reviewer, 'entries', site)) invalid('reviewer', 'This user does not have entry access in this site.')
  }
  return data
}

export const auditEntryReview = (platform: FormPlatform): CollectionAfterChangeHook => async ({ doc, previousDoc, req, operation }) => {
  if (operation !== 'update' || internalRequest(req)) return doc
  const changes: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of reviewFields) {
    const before = key === 'reviewer' ? relationshipID(previousDoc[key]) : previousDoc[key]
    const after = key === 'reviewer' ? relationshipID(doc[key]) : doc[key]
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) changes[key] = { before: before ?? null, after: after ?? null }
  }
  if (!Object.keys(changes).length) return doc
  const site = String(doc.site || FORM_SITE)
  // Cancellation is idempotent. Reopening an entry never silently claims capacity again.
  if (changes.workflowStatus && doc.workflowStatus === 'rejected' && doc.idempotencyKey) await new BookingStore(platform.db).cancel(site, doc.idempotencyKey)
  await req.payload.create({ collection: 'form-audit' as CollectionSlug, overrideAccess: true, req,
    context: { ...req.context, [FORM_INTERNAL]: true },
    data: { label: `Entry ${doc.id} updated`, site, submissionID: String(doc.id), actorID: String(req.user?.id || ''), action: 'entry-review', changes } as never,
  })
  return doc
}
