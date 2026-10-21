import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { FinanceRepository, type GiftKind } from './finance'
import type { Money } from './money'

export function financeEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/finance',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!),
            site = url.searchParams.get('site') || 'default'
          const repository = new FinanceRepository(db, Number(req.user.id)),
            id = url.searchParams.get('id')
          const result =
            url.searchParams.get('view') === 'funds'
              ? await repository.funds(
                  site,
                  url.searchParams.has('afterID')
                    ? {
                        id: url.searchParams.get('afterID') || '',
                        name: url.searchParams.get('afterName') || '',
                      }
                    : undefined,
                )
              : id
                ? { doc: await repository.get(site, id, Number(url.searchParams.get('page') || 1)) }
                : await repository.list({
                    site,
                    constituent: url.searchParams.get('constituent') || undefined,
                    page: Number(url.searchParams.get('page') || 1),
                    limit: Number(url.searchParams.get('limit') || 50),
                  })
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/finance',
      method: 'post',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        const origin = req.headers.get('origin')
        if (origin && origin !== new URL(req.url!).origin)
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403 },
          )
        try {
          const body = await readBoundedJSON(req, 32000),
            repository = new FinanceRepository(db, Number(req.user.id))
          const common = {
            site: String(body.site || ''),
            operationKey: String(body.operationKey || ''),
          }
          let result: Record<string, unknown>
          if (body.action === 'create-fund')
            result = await repository.createFund({ ...common, name: body.name as string })
          else if (body.action === 'create-gift')
            result = await repository.createGift({
              ...common,
              constituent: String(body.constituent || ''),
              amount: body.amount as Money,
              exponent: Number(body.exponent),
              kind: body.kind as GiftKind,
              receivedOn: body.receivedOn as string,
              allocations: body.allocations as Array<Money & { fund: string }>,
              reference: body.reference as string,
              notes: body.notes as string,
            })
          else if (body.action === 'adjust-gift')
            result = await repository.adjust({
              ...common,
              id: String(body.id || ''),
              action: body.adjustment as 'refund' | 'correction' | 'void',
              deltaMinor: body.deltaMinor as string,
              allocations: body.allocations as Array<Money & { fund: string }> | undefined,
              reason: body.reason as string,
              expectedRevision: Number(body.expectedRevision),
            })
          else
            return Response.json(
              { message: 'Choose a supported financial action.' },
              { status: 400 },
            )
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
