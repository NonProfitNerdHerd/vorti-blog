/** Platform authority model. Site context is never itself a grant. */
export const informationCategories = [
  'identity',
  'affiliations',
  'finances',
  'memberships',
  'volunteer-experience',
  'volunteer-hours',
  'communications',
  'restricted-activity',
  'reports',
  'content',
  'workspace',
  'forms',
  'form-submissions',
] as const
export type InformationCategory = (typeof informationCategories)[number]
export const siteOperations = ['read', 'edit', 'export', 'publish', 'configure'] as const
export type SiteOperation = (typeof siteOperations)[number]
export type SiteRole = 'administrator' | 'editor' | 'reader'
export interface SiteNode {
  id: string
  organization: string
  parent: string | null
  archived: boolean
}
export interface SiteMembership {
  user: string
  site: string
  role: SiteRole
  active: boolean
  /** Optional restrictions narrow the role, never grant a capability beyond it. */
  denied?: Array<{ category: InformationCategory; operation: SiteOperation }>
  granted?: Array<{ category: InformationCategory; operation: SiteOperation }>
}
export interface AuthorityRule {
  site: string
  category: InformationCategory
  operation: SiteOperation
  /** A ceiling limits grants issued below its site, including explicit sharing. */
  descendantsAllowed: boolean
  /** Enables this site's members to exercise their role below it. */
  overseeDescendants: boolean
}
export interface SiteGrant {
  organization: string
  source: string
  receiver: string
  receiverDescendants: boolean
  category: InformationCategory
  operations: SiteOperation[]
  revoked: boolean
}
export interface PolicySnapshot {
  sites: SiteNode[]
  memberships: SiteMembership[]
  rules: AuthorityRule[]
  grants: SiteGrant[]
}
export interface AuthorityDecision {
  allowed: boolean
  reason:
    | 'operator'
    | 'local-membership'
    | 'ancestor-oversight'
    | 'explicit-sharing'
    | 'unavailable'
    | 'ancestor-constraint'
    | 'no-grant'
    | 'archived'
    | 'invalid-policy'
  controllingSite?: string
}
const roleAllows = (role: SiteRole, operation: SiteOperation): boolean =>
  role === 'administrator' ||
  (role === 'editor' && ['read', 'edit'].includes(operation)) ||
  (role === 'reader' && operation === 'read')

/** Reject broken ancestry rather than deriving authority from a partial tree. */
export function sitePath(sites: SiteNode[], id: string): SiteNode[] {
  const indexed = new Map(sites.map((site) => [site.id, site]))
  if (indexed.size !== sites.length) throw new Error('Duplicate site identifiers.')
  const path: SiteNode[] = [],
    seen = new Set<string>()
  let current = indexed.get(id)
  if (!current) throw new Error('Site unavailable.')
  const organization = current.organization
  while (current) {
    if (seen.has(current.id)) throw new Error('Site ancestry contains a cycle.')
    if (current.organization !== organization)
      throw new Error('Site ancestry crosses organizations.')
    seen.add(current.id)
    path.unshift(current)
    if (!current.parent) break
    current = indexed.get(current.parent)
    if (!current) throw new Error('Site ancestry is incomplete.')
  }
  return path
}

/** Pure, fail-closed policy evaluation; load snapshots only through trusted server repositories.
 * Export, publication and policy administration never follow from edit permission.
 * Caller must additionally enforce record restrictions and document/workspace permissions.
 */
export function evaluateSiteAuthority(input: {
  snapshot: PolicySnapshot
  user: string | null
  installationOperator: boolean
  owningSite: string
  category: InformationCategory
  operation: SiteOperation
}): AuthorityDecision {
  const { snapshot, user, owningSite, category, operation } = input
  if (!user) return { allowed: false, reason: 'unavailable' }
  let path: SiteNode[]
  try {
    path = sitePath(snapshot.sites, owningSite)
  } catch {
    return { allowed: false, reason: 'invalid-policy' }
  }
  const target = path[path.length - 1]
  if (operation !== 'read' && path.some((site) => site.archived))
    return { allowed: false, reason: 'archived' }
  if (input.installationOperator) return { allowed: true, reason: 'operator' }
  // Rules are unique per site/category/operation. Ambiguous policy must not grant access.
  const relevant = snapshot.rules.filter(
    (rule) => rule.category === category && rule.operation === operation,
  )
  const keys = relevant.map((rule) => rule.site)
  if (new Set(keys).size !== keys.length) return { allowed: false, reason: 'invalid-policy' }
  const ancestors = path.slice(0, -1)
  const constraint = ancestors.find((site) =>
    relevant.some((rule) => rule.site === site.id && !rule.descendantsAllowed),
  )
  // A locked ceiling governs both local delegated permissions and imported sharing grants.
  if (constraint)
    return { allowed: false, reason: 'ancestor-constraint', controllingSite: constraint.id }
  const memberships = snapshot.memberships.filter(
    (member) =>
      member.active &&
      member.user === user &&
      (roleAllows(member.role, operation) || member.granted?.some(grant => grant.category === category && grant.operation === operation)) &&
      !member.denied?.some(
        (denial) => denial.category === category && denial.operation === operation,
      ),
  )
  if (memberships.some((member) => member.site === target.id))
    return { allowed: true, reason: 'local-membership', controllingSite: target.id }
  for (const ancestor of ancestors) {
    if (
      memberships.some((member) => member.site === ancestor.id) &&
      relevant.some((rule) => rule.site === ancestor.id && rule.overseeDescendants)
    )
      return { allowed: true, reason: 'ancestor-oversight', controllingSite: ancestor.id }
  }
  // Policy authority cannot be imported through a record-sharing grant.
  if (operation === 'configure') return { allowed: false, reason: 'no-grant' }
  for (const grant of snapshot.grants) {
    if (
      grant.revoked ||
      grant.organization !== target.organization ||
      grant.source !== target.id ||
      grant.category !== category ||
      !grant.operations.includes(operation)
    )
      continue
    let receiverPath: SiteNode[]
    try {
      receiverPath = sitePath(snapshot.sites, grant.receiver)
    } catch {
      continue
    }
    if (receiverPath[0].organization !== target.organization) continue
    for (const membership of memberships) {
      let memberPath: SiteNode[]
      try {
        memberPath = sitePath(snapshot.sites, membership.site)
      } catch {
        continue
      }
      if (
        memberPath[0].organization !== target.organization ||
        memberPath.some((site) => site.archived)
      )
        continue
      const receives =
        membership.site === grant.receiver ||
        (grant.receiverDescendants && memberPath.some((site) => site.id === grant.receiver))
      if (!receives) continue
      const receiverConstraint = memberPath
        .slice(0, -1)
        .find((site) => relevant.some((rule) => rule.site === site.id && !rule.descendantsAllowed))
      if (!receiverConstraint)
        return { allowed: true, reason: 'explicit-sharing', controllingSite: grant.source }
    }
  }
  return { allowed: false, reason: 'no-grant' }
}

export function assertSiteMove(sites: SiteNode[], siteID: string, parentID: string | null): void {
  const current = sitePath(sites, siteID).at(-1)!
  if (!parentID) {
    if (current.parent)
      throw new Error(
        'A descendant cannot become a separate organization root through a site move.',
      )
    return
  }
  const destination = sitePath(sites, parentID)
  if (!current.parent) throw new Error('An organization root cannot be reparented.')
  if (destination.some((site) => site.id === siteID))
    throw new Error('A site cannot move below itself.')
  if (destination[0].organization !== current.organization)
    throw new Error('Sites cannot move between organizations.')
  if (destination.some((site) => site.archived))
    throw new Error('Restore the destination before moving a site.')
}
