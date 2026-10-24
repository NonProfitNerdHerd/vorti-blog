import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { MembershipRepository } from './memberships'
export function membershipEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/memberships',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const u = new URL(req.url!),
            repo = new MembershipRepository(db, Number(req.user.id)),
            site = u.searchParams.get('site') || '',
            asOf = u.searchParams.get('asOf') || '',
            id = u.searchParams.get('id')
          const result =
            u.searchParams.get('view') === 'types'
              ? await repo.types(site, u.searchParams.get('after') || '')
              : id
                ? await repo.get(site, id, asOf)
                : await repo.list(
                    site,
                    asOf,
                    u.searchParams.get('status') || 'all',
                    u.searchParams.get('after') || '',
                    u.searchParams.get('contact') || '',
                  )
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (e) {
          return errorResponse(e)
        }
      },
    },
    {
      path: '/crm/memberships',
      method: 'post',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url!).origin)
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403 },
          )
        try {
          const b = await readBoundedJSON(req, 24000),
            repo = new MembershipRepository(db, Number(req.user.id)),
            common = { site: String(b.site || ''), operationKey: String(b.operationKey || '') }
          let doc: Record<string, unknown>
          if (b.action === 'cancel')
            doc = await repo.cancel({
              ...common,
              id: String(b.id || ''),
              expectedRevision: Number(b.expectedRevision),
              effectiveOn: String(b.effectiveOn || ''),
              reason: String(b.reason || ''),
            })
          else {
            if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values))
              throw new Error('Enter valid membership values.')
            if (b.action === 'save-type')
              doc = await repo.saveType({
                ...common,
                id: typeof b.id === 'string' ? b.id : undefined,
                expectedRevision:
                  typeof b.expectedRevision === 'number' ? b.expectedRevision : undefined,
                values: b.values as Record<string, unknown>,
              })
            else if (b.action === 'enroll')
              doc = await repo.enroll({ ...common, values: b.values as Record<string, unknown> })
            else throw new Error('Choose a supported membership action.')
          }
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (e) {
          return errorResponse(e)
        }
      },
    },
  ]
}
