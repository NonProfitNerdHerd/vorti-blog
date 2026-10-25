import type { Endpoint } from 'payload'
import { crmOverview } from './overview'
export function overviewEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/overview',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          return Response.json(
            await crmOverview(
              db,
              Number(req.user.id),
              new URL(req.url!).searchParams.get('site') || 'default',
              undefined,
              new URL(req.url!).searchParams.get('contact') || undefined,
            ),
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
