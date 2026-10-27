import type { Access } from 'payload'
import { authorityClaim } from '../organizations/claims'

export const manageTags: Access = async ({ req }) => {
  if (!req.user) return false
  const claim = authorityClaim(req.user)
  if (claim?.permissions) return claim.permissions.includes('administration:tags')
  if (req.user.role === 'administrator') return true
  const settings = await req.payload.findGlobal({
    slug: 'system-settings',
    depth: 0,
    req,
    overrideAccess: false,
  })
  return (settings.tagManagementRoles ?? ['administrator', 'designer', 'editor']).includes(
    req.user.role || 'editor',
  )
}
