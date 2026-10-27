import type { Access, PayloadRequest, Where } from 'payload'
import { authorityClaim, type ClaimedUser } from '../organizations/claims'
import type { InformationCategory, SiteOperation } from '../organizations/policy'
import type { Permission } from '../organizations/permission-catalog'

export const FORM_SITE = 'default'
export type FormPermission = 'create' | 'edit' | 'publish' | 'entries' | 'sensitive' | 'export' | 'integrations' | 'admin'
export interface FormsUser extends ClaimedUser { role?: string; platformForms?: unknown; formAccess?: unknown }
export const formCapabilities: Record<FormPermission, [InformationCategory, SiteOperation]> = {
  create: ['forms', 'edit'], edit: ['forms', 'edit'], publish: ['forms', 'publish'],
  entries: ['form-submissions', 'read'], sensitive: ['form-submissions', 'configure'],
  export: ['form-submissions', 'export'], integrations: ['forms', 'configure'], admin: ['forms', 'configure'],
}
export function permittedSites(user: FormsUser | null | undefined, permission: FormPermission): string[] {
  if (!user) return []
  const claim = authorityClaim(user), [category, operation] = formCapabilities[permission]
  if (claim?.permissions) {
    const exact: Record<FormPermission, Permission> = { create: 'forms:create', edit: 'forms:edit', publish: 'forms:publish', entries: 'forms:read-submissions', sensitive: 'forms:read-sensitive', export: 'forms:export', integrations: 'forms:configure-integrations', admin: 'forms:configure-integrations' }
    return claim.permissions.includes(exact[permission]) ? [claim.site] : []
  }
  if (claim) return claim.allowed[category]?.includes(operation) ? [claim.site] : []
  // Serialized UI hints never authorize server operations. HTTP clients cannot forge the Symbol.
  if (typeof window !== 'undefined' && Array.isArray(user.platformForms)) return user.platformForms.filter(item => typeof item?.site === 'string' && Array.isArray(item.permissions) && item.permissions.includes(permission)).map(item => item.site)
  return []
}
export function canForm(user: FormsUser | null | undefined, permission: FormPermission, site = FORM_SITE): boolean {
  return permittedSites(user, permission).includes(site)
}
export const siteAccess = (permission: FormPermission): Access => ({ req, data }) => {
  const sites = permittedSites(req.user as FormsUser, permission)
  if (!sites.length) return false
  if (data?.site && !sites.includes(String(data.site))) return false
  return { site: { in: sites } } as Where
}
export function requireFormPermission(req: PayloadRequest, permission: FormPermission, site = FORM_SITE): void {
  if (!canForm(req.user as FormsUser, permission, site)) throw new Error('You do not have permission for this form operation.')
}
/** Symbol context is created by server handlers; JSON requests cannot forge it. */
export const FORM_INTERNAL = Symbol('trusted-form-runtime')
export function internalRequest(req: PayloadRequest): boolean { return (req.context as Record<symbol, unknown>)[FORM_INTERNAL] === true }
