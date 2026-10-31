import { sitePath, type SiteNode } from './policy'
import {
  isPermission,
  readPermissions,
  type ApplicationFeature,
  type FeatureOverride,
  type Permission,
} from './permission-catalog'

export interface TenantRole {
  id: string
  tenant: string
  /** Only trusted persisted built-in definitions may carry this discriminator. */
  builtin: 'tenant-administrator' | 'site-administrator' | null
  retired: boolean
  permissions: Permission[]
}
export interface TenantAssignment {
  role: string
  site: string | null
  descendants: boolean
}
export interface TenantPolicy {
  tenant: string
  accountActive: boolean
  membershipActive: boolean
  sites: SiteNode[]
  roles: TenantRole[]
  assignments: TenantAssignment[]
  denied: Permission[]
}
export type TenantDecision = {
  allowed: boolean
  privateRead: boolean
  auditAdministratorRead: boolean
  reason:
    'unavailable' | 'invalid-policy' | 'restricted' | 'no-grant' | 'role' | 'tenant-administrator'
}
const deny = (reason: TenantDecision['reason']): TenantDecision => ({
  allowed: false,
  privateRead: false,
  auditAdministratorRead: false,
  reason,
})

/** Input must come from server repositories, never request JSON or serialized user claims. */
export function evaluateTenantPermission(
  policy: TenantPolicy,
  input: {
    site: string
    permission: Permission
    featureAvailable: boolean
    privateRecord?: boolean
    /** Result of the resource repository's ownership/sharing/visibility policy. */
    recordAccess?: boolean
  },
): TenantDecision {
  if (!policy.accountActive || !policy.membershipActive || !input.featureAvailable)
    return deny('unavailable')
  if (!isPermission(input.permission)) return deny('invalid-policy')
  let path: SiteNode[]
  try {
    path = sitePath(policy.sites, input.site)
  } catch {
    return deny('invalid-policy')
  }
  if (path.some((site) => site.organization !== policy.tenant || site.archived))
    return deny('unavailable')
  const roles = new Map(policy.roles.map((role) => [role.id, role]))
  if (roles.size !== policy.roles.length) return deny('invalid-policy')
  const applicable: TenantRole[] = []
  for (const assignment of policy.assignments) {
    const role = roles.get(assignment.role)
    if (!role || role.tenant !== policy.tenant) return deny('invalid-policy')
    if (role.retired) continue
    if (role.builtin === 'tenant-administrator' && assignment.site !== null)
      return deny('invalid-policy')
    if (role.builtin === 'site-administrator' && assignment.site === null)
      return deny('invalid-policy')
    if (assignment.site !== null) {
      const scope = policy.sites.find((site) => site.id === assignment.site)
      if (!scope || scope.organization !== policy.tenant) return deny('invalid-policy')
    }
    if (
      assignment.site === null ||
      assignment.site === input.site ||
      (assignment.descendants && path.some((site) => site.id === assignment.site))
    )
      applicable.push(role)
  }
  const administrator = applicable.some((role) => role.builtin === 'tenant-administrator')
  // The special built-in read exception is not a permission toggle. Business mutation
  // restrictions, secret masking and record integrity are enforced by their repositories.
  if (administrator && readPermissions.has(input.permission))
    return {
      allowed: true,
      privateRead: true,
      auditAdministratorRead: true,
      reason: 'tenant-administrator',
    }
  if (policy.denied.includes(input.permission)) return deny('restricted')
  if (input.privateRecord && !input.recordAccess) return deny('no-grant')
  if (!applicable.some((role) => role.permissions.includes(input.permission)))
    return deny('no-grant')
  return { allowed: true, privateRead: false, auditAdministratorRead: false, reason: 'role' }
}

export interface FeaturePolicy {
  tenant: string
  sites: SiteNode[]
  available: Record<ApplicationFeature, boolean>
  overrides: Array<{ site: string; feature: ApplicationFeature; value: FeatureOverride }>
}

/** Revalidate this for every existing assignment when a custom role changes. */
export function canDelegate(
  policy: TenantPolicy,
  grant: { site: string | null; descendants: boolean; permissions: Permission[] },
): boolean {
  if (!policy.accountActive || !policy.membershipActive) return false
  const active = policy.sites.filter(
    (site) => site.organization === policy.tenant && !site.archived,
  )
  const administrator = policy.assignments.some(
    (assignment) =>
      assignment.site === null &&
      policy.roles.some(
        (role) =>
          role.id === assignment.role &&
          role.tenant === policy.tenant &&
          role.builtin === 'tenant-administrator' &&
          !role.retired,
      ),
  )
  if (grant.site === null && !administrator) return false
  if (grant.site !== null && !active.some((site) => site.id === grant.site)) return false
  let scope: SiteNode[]
  try {
    if (
      grant.descendants &&
      !administrator &&
      ![...grant.permissions, 'administration:assignments' as const].every((permission) =>
        policy.assignments.some(
          (assignment) =>
            assignment.descendants &&
            (assignment.site === null ||
              (grant.site !== null &&
                sitePath(active, grant.site).some(
                  (ancestor) => ancestor.id === assignment.site,
                ))) &&
            policy.roles.some(
              (role) =>
                role.id === assignment.role &&
                role.tenant === policy.tenant &&
                !role.retired &&
                role.permissions.includes(permission),
            ),
        ),
      )
    )
      return false
    scope = active.filter(
      (site) =>
        grant.site === null ||
        site.id === grant.site ||
        (grant.descendants &&
          sitePath(active, site.id).some((ancestor) => ancestor.id === grant.site)),
    )
  } catch {
    return false
  }
  return (
    scope.length > 0 &&
    scope.every((site) =>
      grant.permissions.every(
        (permission) =>
          evaluateTenantPermission(policy, { site: site.id, permission, featureAvailable: true })
            .allowed,
      ),
    )
  )
}
export function effectiveFeature(
  policy: FeaturePolicy,
  site: string,
  feature: ApplicationFeature,
): {
  available: boolean
  controllingScope: string
  configured: FeatureOverride
  locked: boolean
} {
  if (feature === 'crm' && !effectiveFeature(policy, site, 'tasks').available)
    return { available: false, controllingScope: site, configured: policy.overrides.find((entry) => entry.site === site && entry.feature === 'crm')?.value ?? 'inherit', locked: !policy.available.crm }
  const path = sitePath(policy.sites, site)
  if (path.some((node) => node.organization !== policy.tenant || node.archived))
    throw Error('Site unavailable.')
  const overrides = policy.overrides.filter((entry) => entry.feature === feature)
  if (new Set(overrides.map((entry) => entry.site)).size !== overrides.length)
    throw Error('Duplicate feature overrides.')
  const configured = overrides.find((entry) => entry.site === site)?.value ?? 'inherit'
  if (!policy.available[feature])
    return { available: false, controllingScope: policy.tenant, configured, locked: true }
  for (const node of [...path].reverse()) {
    const value = overrides.find((entry) => entry.site === node.id)?.value
    if (value && value !== 'inherit')
      return {
        available: value === 'enabled',
        controllingScope: node.id,
        configured,
        locked: false,
      }
  }
  return { available: true, controllingScope: policy.tenant, configured, locked: false }
}
