import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { CorrespondenceBatches } from './correspondence-batches'
import { correspondenceCandidates } from './correspondence-batch-selection'

export function correspondenceBatchEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
  storage?: R2Bucket,
): Endpoint[] {
  const headers = { 'Cache-Control': 'private, no-store' }
  return [
    {
      path: '/crm/correspondence-batches',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        try {
          const p = new URL(req.url!).searchParams,
            site = p.get('site') || '',
            id = p.get('id') || '',
            actor = Number(req.user.id),
            batches = new CorrespondenceBatches(db, actor)
          const result =
            p.get('view') === 'preview'
              ? await batches.preview(site, id, p.get('recipient') || '')
              : p.get('view') === 'candidates'
                ? await correspondenceCandidates(db, actor, {
                    site,
                    batch: id,
                    after: p.get('after') || '',
                    search: p.get('search') || '',
                    from: p.get('from') || '',
                    through: p.get('through') || '',
                    givingOnly: p.get('givingOnly') !== 'false',
                  })
                : id
                  ? await batches.get(site, id, p.get('after') || '')
                  : await batches.list(site, p.get('after') || '')
          return Response.json(result, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/correspondence-batches',
      method: 'post',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url!).origin)
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403, headers },
          )
        try {
          const b = await readBoundedJSON(req, 16000),
            batches = new CorrespondenceBatches(db, Number(req.user.id)),
            common = {
              site: String(b.site || ''),
              id: String(b.id || ''),
              expectedRevision: Number(b.expectedRevision),
              operationKey: String(b.operationKey || ''),
            }
          let doc: Record<string, unknown>
          if (b.action === 'save') {
            if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values))
              throw new Error('Enter valid batch configuration.')
            doc = await batches.save({
              ...common,
              id: common.id || undefined,
              name: String(b.name || ''),
              values: b.values as Record<string, unknown>,
            })
          } else if (b.action === 'prepare-recipient') {
            if (!b.recipient || typeof b.recipient !== 'object' || Array.isArray(b.recipient))
              throw new Error('Choose a valid recipient.')
            doc = await batches.prepareRecipient({
              ...common,
              recipient: b.recipient as Record<string, unknown>,
            })
          } else if (b.action === 'process') {
            if (!storage)
              return Response.json(
                { message: 'Private document storage is not configured.' },
                { status: 503, headers },
              )
            doc = await batches.process(common.site, common.id, storage)
          } else if (b.action === 'remove-recipient')
            doc = await batches.remove({ ...common, recipient: String(b.recipient || '') })
          else if (b.action === 'approve') doc = await batches.approve(common)
          else if (b.action === 'reopen') doc = await batches.reopen(common)
          else if (b.action === 'retry' || b.action === 'cancel')
            doc = await batches.control({
              ...common,
              action: b.action,
              job: String(b.job || ''),
              expectedFence: Number(b.expectedFence),
            })
          else throw new Error('Choose a supported correspondence batch action.')
          return Response.json({ doc }, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
