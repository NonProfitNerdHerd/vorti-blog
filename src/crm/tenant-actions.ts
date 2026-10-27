import { tenantAuthorityActive } from '../organizations/tenant-runtime'
import { TenantRepository } from '../organizations/tenant-repository'
import { SiteConflictError } from '../organizations/atomic'
import type { Permission } from '../organizations/permission-catalog'

/** Domain actions keep their category/business guards and add the independent tenant action. */
export function crmMutationPermissions(
  action: string,
  before?: unknown,
  after?: unknown,
): Permission[] {
  const result: Permission[] = []
  if (/^merge[.-]/.test(action)) result.push('crm:merge')
  else if (/^import[.-]/.test(action)) result.push('crm:import')
  else if (
    /^(email\.settings|fund\.|funds\.|campaigns\.|appeals\.|pipeline\.|stage\.|membership-type\.|template\.)/.test(
      action,
    )
  )
    result.push('crm:configure')
  else if (/archive|restore/.test(action)) result.push('crm:archive')
  else if (/(?:^delete-|\.deleted$|\.removed$)/.test(action)) result.push('crm:delete')
  else if (/(?:^create-|\.(created|staged|uploaded|issued|enrolled)$)/.test(action))
    result.push('crm:create')
  else result.push('crm:edit')
  const previous = before && typeof before === 'object' ? (before as Record<string, unknown>) : {},
    next = after && typeof after === 'object' ? (after as Record<string, unknown>) : {}
  if ('archived' in next && next.archived !== previous.archived && Boolean(next.archived))
    result.push('crm:archive')
  if (
    before &&
    ['owner', 'owner_id', 'assigned_to'].some((key) => key in next && next[key] !== previous[key])
  )
    result.push('crm:assign')
  return [...new Set(result)]
}
export async function requireCRMAction(
  db: D1Database,
  actor: number,
  site: string,
  permission: Permission,
  revision?: number,
) {
  if (!(await tenantAuthorityActive(db, site))) return
  const authority = await new TenantRepository(db, actor).require(site, permission)
  if (revision !== undefined && authority.revision !== revision) throw new SiteConflictError()
}
export async function authorizeCRMMutation(input: {
  db: D1Database
  actor: number
  site: string
  action: string
  authorityRevision: number
  before?: unknown
  after?: unknown
}) {
  for (const permission of crmMutationPermissions(input.action, input.before, input.after))
    await requireCRMAction(input.db, input.actor, input.site, permission, input.authorityRevision)
}
