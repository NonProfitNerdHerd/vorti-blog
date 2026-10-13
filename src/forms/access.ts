import type { Access, PayloadRequest, Where } from 'payload'

export const FORM_SITE = 'default'
export type FormPermission = 'create' | 'edit' | 'publish' | 'entries' | 'sensitive' | 'export' | 'integrations' | 'admin'
export interface FormsUser { id: number | string; role?: string; formAccess?: { site: string; permissions: FormPermission[] }[] }
const roleDefaults: Record<string, FormPermission[]> = {
  administrator: ['create', 'edit', 'publish', 'entries', 'sensitive', 'export', 'integrations', 'admin'],
  designer: ['create', 'edit', 'publish'], editor: ['entries'],
}
export function permittedSites(user: FormsUser | null | undefined, permission: FormPermission): string[] {
  if (!user) return []
  return [...new Set([...(roleDefaults[user.role || '']?.includes(permission) ? [FORM_SITE] : []),
    ...(user.formAccess || []).filter(item => item.permissions?.includes(permission)).map(item => item.site)])]
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
