import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { HouseholdRepository } from './households'

export function householdEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/households',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!),
            site = url.searchParams.get('site') || '',
            id = url.searchParams.get('id') || ''
          const repo = new HouseholdRepository(db, Number(req.user.id))
          const contact = url.searchParams.get('contact')
          const result = contact
            ? await repo.relationships(site, contact, url.searchParams.get('after') || '')
            : id
              ? url.searchParams.get('view') === 'giving'
                ? await repo.giving(site, id)
                : await repo.get(site, id)
              : await repo.list(
                  site,
                  url.searchParams.get('search') || '',
                  url.searchParams.get('after') || '',
                )
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/households',
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
          const body = await readBoundedJSON(req, 24000)
          if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values))
            throw new Error('Enter valid household values.')
          const result = await new HouseholdRepository(db, Number(req.user.id)).mutate({
            site: String(body.site || ''),
            action: String(body.action || ''),
            operationKey: String(body.operationKey || ''),
            id: typeof body.id === 'string' ? body.id : undefined,
            expectedRevision:
              typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
            values: body.values as Record<string, unknown>,
          })
          return Response.json(
            { doc: result },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
