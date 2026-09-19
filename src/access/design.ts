import type { Access, User } from 'payload'

type DesignUser = { role?: string } | null | undefined

export const isDesignManager = (user: DesignUser): boolean =>
  !!user && (user.role === 'administrator' || user.role === 'designer')

export const canManageDesign: Access = ({ req }) => isDesignManager(req.user as User & { role?: string })
