import type { Endpoint } from 'payload'
import { ContactTimeline } from './timeline'
export function timelineEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/timeline',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json(
            { message: 'Sign in to use CRM.' },
            { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
          )
        try {
          const query = new URL(req.url!).searchParams
          const cursor = ['beforeDate', 'beforeID', 'authorityRevision'].map((name) =>
            query.has(name),
          )
          if (cursor.some(Boolean) && !cursor.every(Boolean))
            throw new Error('Invalid page cursor.')
          const result = await new ContactTimeline(db, Number(req.user.id)).list({
            site: query.get('site') || '',
            contact: query.get('contact') || '',
            group: query.get('group') || '',
            before: cursor.every(Boolean)
              ? {
                  date: query.get('beforeDate')!,
                  id: query.get('beforeID')!,
                  revision: Number(query.get('authorityRevision')),
                }
              : undefined,
          })
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
