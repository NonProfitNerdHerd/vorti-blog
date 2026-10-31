import type { PayloadRequest, Where } from 'payload'
import { authorityClaim } from '../organizations/claims'
import { crmRecordRulesV3 } from './record-context-v3'
export const crmTaskInternalRead = Symbol.for('vorticause.server-crm-task-read')
export function crmTaskInternalReadAllowed(req: PayloadRequest) {
  return (req.context as Record<PropertyKey, unknown>)[crmTaskInternalRead] === true
}
export function crmTaskLinksActive(req: PayloadRequest) {
  return !!req.payload?.config?.collections?.some(
    (collection) => collection.slug === ('crm-task-contexts' as string),
  )
}
/** Native relationship filtering applies before pagination, counts and exports.
 * No per-record ID list, record cache or administrator bypass is used. */
export function crmTaskWhere(
  req: PayloadRequest,
  permission: 'read' | 'edit' | 'comment',
  prefix = '',
  workspace: boolean | Where,
): boolean | Where {
  if (!workspace) return false
  // Older standalone Tasks configurations have no CRM fields. In VortiCause the
  // server plugin always registers this bridge together with the additive view.
  if (!crmTaskLinksActive(req)) return workspace
  const unlinked: Where = { [`${prefix}crmType`]: { exists: false } },
    claim = authorityClaim(req.user),
    operation = permission === 'read' ? 'read' : 'edit'
  const categories = [
    ...new Set(Object.values(crmRecordRulesV3).map((rule) => rule.category)),
  ].filter(
    (category) =>
      claim?.allowed[category]?.includes('read') && claim.allowed[category]?.includes(operation),
  )
  const linked: Where =
    claim?.allowed.identity?.includes('read') &&
    claim.allowed.workspace?.includes(operation) &&
    categories.length
      ? {
          and: [
            { [`${prefix}crmContext.site`]: { equals: claim.site } },
            { [`${prefix}crmContext.category`]: { in: categories } },
            ...(!claim.allowed.finances?.includes('read') || !claim.allowed.finances?.includes(operation) ? [{ [`${prefix}crmContext.financial`]: { equals: 0 } }] : []),
            ...(!claim.allowed.memberships?.includes('read') || !claim.allowed.memberships?.includes(operation) ? [{ [`${prefix}crmContext.membership`]: { equals: 0 } }] : []),
            ...(!claim.allowed['restricted-activity']?.includes('read') ? [{ [`${prefix}crmContext.restricted`]: { equals: 0 } }] : []),
            ...(!claim.allowed.communications?.includes('read') || !claim.allowed.communications?.includes(operation) ? [{ [`${prefix}crmContext.communications`]: { equals: 0 } }] : []),
            { or: [{ [`${prefix}crmContext.owner`]: { exists: false } }, { [`${prefix}crmContext.owner`]: { equals: claim.actor } }] },
          ],
        }
      : { id: { equals: -1 } }
  return { and: [...(workspace === true ? [] : [workspace]), { or: [unlinked, linked] }] }
}
