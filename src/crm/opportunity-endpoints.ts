import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { OpportunityRepository } from './opportunities'
export function opportunityEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/opportunities',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const p = new URL(req.url!).searchParams,
            site = p.get('site') || '',
            repo = new OpportunityRepository(db, Number(req.user.id)),
            view = p.get('view'),
            id = p.get('id')
          const result =
            view === 'pipelines'
              ? await repo.pipelines(site, p.get('after') || '')
              : view === 'stages'
                ? await repo.stages(site, p.get('pipeline') || '')
                : view === 'owners'
                  ? await repo.owners(site, Number(p.get('after') || 0))
                  : id
                    ? await repo.get(
                        site,
                        id,
                        p.get('historyAfter') || '',
                        p.get('linkAfter') || '',
                      )
                    : await repo.list({
                        site,
                        pipeline: p.get('pipeline') || undefined,
                        stage: p.get('stage') || undefined,
                        contact: p.get('contact') || undefined,
                        after: p.get('after') || undefined,
                        dueThrough: p.get('dueThrough') || undefined,
                        owner: p.has('owner') ? Number(p.get('owner')) : undefined,
                        archived: p.get('archived') === 'true',
                      })
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/opportunities',
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
          const b = await readBoundedJSON(req, 32000),
            repo = new OpportunityRepository(db, Number(req.user.id)),
            common = { site: String(b.site || ''), operationKey: String(b.operationKey || '') }
          let doc: Record<string, unknown>
          if (['save', 'save-pipeline', 'save-stage'].includes(String(b.action))) {
            if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values))
              throw new Error('Enter valid opportunity values.')
            const input = {
              ...common,
              id: typeof b.id === 'string' ? b.id : undefined,
              expectedRevision:
                typeof b.expectedRevision === 'number' ? b.expectedRevision : undefined,
              values: b.values as Record<string, unknown>,
            }
            doc =
              b.action === 'save'
                ? await repo.save(input)
                : b.action === 'save-pipeline'
                  ? await repo.savePipeline(input)
                  : await repo.saveStage(input)
          } else if (b.action === 'link' || b.action === 'unlink') {
            if (b.action === 'unlink' && (typeof b.link !== 'string' || !b.link))
              throw new Error('Choose a financial link to remove.')
            doc = await repo.link({
              ...common,
              id: String(b.id || ''),
              expectedRevision: Number(b.expectedRevision),
              gift: typeof b.gift === 'string' ? b.gift : undefined,
              pledge: typeof b.pledge === 'string' ? b.pledge : undefined,
              remove: b.action === 'unlink' ? String(b.link) : undefined,
              reason: String(b.reason || ''),
            })
          } else throw new Error('Choose a supported opportunity action.')
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
