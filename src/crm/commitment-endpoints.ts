import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { CommitmentRepository, commitmentKind } from './commitments'
export function commitmentEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/giving',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!),
            repo = new CommitmentRepository(db, Number(req.user.id)),
            site = url.searchParams.get('site') || '',
            id = url.searchParams.get('id')
          const result =
            url.searchParams.get('view') === 'history'
              ? await repo.history(
                  site,
                  id || '',
                  url.searchParams.has('afterID')
                    ? {
                        id: url.searchParams.get('afterID') || '',
                        createdAt: url.searchParams.get('afterCreatedAt') || '',
                      }
                    : undefined,
                )
              : id
                ? await repo.get(
                    site,
                    id,
                    url.searchParams.get('through') || '',
                    Number(url.searchParams.get('offset') || 0),
                  )
                : await repo.list(
                    site,
                    commitmentKind(url.searchParams.get('kind') || ''),
                    url.searchParams.get('after') || '',
                    url.searchParams.get('contact') || '',
                  )
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/giving',
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
          const b = await readBoundedJSON(req, 48000),
            repo = new CommitmentRepository(db, Number(req.user.id))
          if (
            b.action === 'reverse-payment' &&
            (typeof b.application !== 'string' || !b.application)
          )
            throw new Error('Choose a payment application to reverse.')
          const common = { site: String(b.site || ''), operationKey: String(b.operationKey || '') }
          let doc: Record<string, unknown>
          if (b.action === 'create') {
            if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values))
              throw new Error('Enter valid giving values.')
            doc = await repo.create({ ...common, values: b.values as Record<string, unknown> })
          } else if (b.action === 'apply-payment' || b.action === 'reverse-payment')
            doc = await repo.apply({
              ...common,
              id: String(b.id || ''),
              expectedRevision: Number(b.expectedRevision),
              gift: String(b.gift || ''),
              giftRevision: Number(b.giftRevision),
              installment: String(b.installment || ''),
              minorUnits: String(b.minorUnits || ''),
              reason: String(b.reason || ''),
              reverseApplication:
                b.action === 'reverse-payment' ? String(b.application || '') : undefined,
            })
          else if (['pause', 'resume', 'cancel', 'rename'].includes(String(b.action)))
            doc = await repo.change({
              ...common,
              id: String(b.id || ''),
              expectedRevision: Number(b.expectedRevision),
              action: b.action as 'pause' | 'resume' | 'cancel' | 'rename',
              effectiveOn: String(b.effectiveOn || ''),
              reason: String(b.reason || ''),
              name: typeof b.name === 'string' ? b.name : undefined,
            })
          else throw new Error('Choose a supported giving action.')
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
