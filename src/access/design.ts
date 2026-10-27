import type { Access, User } from 'payload'
import { authorityClaim } from '../organizations/claims'

type DesignUser = { id?:string|number;role?: string;platformAuthority?:unknown;platformPermissions?:unknown } | null | undefined

export const isDesignManager = (user: DesignUser): boolean => {
  const claim=user?.id?authorityClaim(user as {id:string|number;platformAuthority?:unknown}):null
  if(claim?.permissions)return claim.permissions.includes('administration:designs')||claim.permissions.includes('administration:templates')
  if(typeof window!=='undefined'&&Array.isArray(user?.platformPermissions))return user.platformPermissions.includes('administration:designs')||user.platformPermissions.includes('administration:templates')
  return !!user && (user.role === 'administrator' || user.role === 'designer')
}

export const canManageDesign: Access = ({ req }) => isDesignManager(req.user as User & { role?: string })
