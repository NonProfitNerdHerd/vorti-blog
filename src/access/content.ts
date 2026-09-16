import type { CollectionConfig } from 'payload'

export const authenticated = ({ req }: { req: { user?: unknown } }): boolean => Boolean(req.user)

export const publishedOrAuthenticated: NonNullable<CollectionConfig['access']>['read'] = ({ req }) =>
  req.user ? true : { _status: { equals: 'published' } }
