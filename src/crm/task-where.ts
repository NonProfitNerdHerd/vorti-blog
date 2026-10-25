import type { PayloadRequest, Where } from 'payload'
import { authorityClaim } from '../organizations/claims'
import { crmRecordRulesV1 } from './record-context-v1'
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
    ...new Set(Object.values(crmRecordRulesV1).map((rule) => rule.category)),
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
          ],
        }
      : { id: { equals: -1 } }
  return { and: [...(workspace === true ? [] : [workspace]), { or: [unlinked, linked] }] }
}
