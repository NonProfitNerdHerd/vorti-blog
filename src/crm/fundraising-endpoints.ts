import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { classificationKind, FundraisingRepository } from './fundraising'
export function fundraisingEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/fundraising',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!),
            repo = new FundraisingRepository(db, Number(req.user.id)),
            site = url.searchParams.get('site') || ''
          const kind = classificationKind(url.searchParams.get('kind') || ''),
            id = url.searchParams.get('id'),
            after = url.searchParams.get('after') || ''
          const result = url.searchParams.get('gift')
            ? await repo.attribution(site, url.searchParams.get('gift')!)
            : id
              ? await repo.linkedGifts(site, kind, id, after)
              : await repo.list(site, kind, after)
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/fundraising',
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
          const body = await readBoundedJSON(req, 24000),
            repo = new FundraisingRepository(db, Number(req.user.id))
          const common = {
            site: String(body.site || ''),
            operationKey: String(body.operationKey || ''),
          }
          let doc: Record<string, unknown>
          if (body.action === 'attribute')
            doc = await repo.attribute({
              ...common,
              gift: String(body.gift || ''),
              campaign: body.campaign ? String(body.campaign) : null,
              appeal: body.appeal ? String(body.appeal) : null,
              expectedRevision: Number(body.expectedRevision),
              reason: String(body.reason || ''),
            })
          else {
            if (
              body.action !== 'save' ||
              !body.values ||
              typeof body.values !== 'object' ||
              Array.isArray(body.values)
            )
              throw new Error('Choose a supported fundraising action.')
            doc = await repo.save({
              ...common,
              kind: classificationKind(String(body.kind)),
              id: typeof body.id === 'string' ? body.id : undefined,
              expectedRevision:
                typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
              values: body.values as Record<string, unknown>,
            })
          }
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
