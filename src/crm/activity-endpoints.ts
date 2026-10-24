import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { ActivityRepository } from './activities'
export function activityEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/activities',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!)
          return Response.json(
            await new ActivityRepository(db, Number(req.user.id)).list(
              url.searchParams.get('site') || '',
              url.searchParams.get('contact') || '',
              url.searchParams.get('after') || '',
            ),
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/activities',
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
          const b = await readBoundedJSON(req, 24000)
          if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values))
            throw new Error('Enter valid communication values.')
          const doc = await new ActivityRepository(db, Number(req.user.id)).save({
            site: String(b.site || ''),
            contact: String(b.contact || ''),
            id: typeof b.id === 'string' ? b.id : undefined,
            expectedRevision:
              typeof b.expectedRevision === 'number' ? b.expectedRevision : undefined,
            operationKey: String(b.operationKey || ''),
            values: b.values as Record<string, unknown>,
          })
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
