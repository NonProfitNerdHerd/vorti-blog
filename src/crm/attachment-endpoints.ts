import type { Endpoint, PayloadRequest } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { CRMAttachments } from './attachments'
import { crmRecordLink } from './record-model'

export function attachmentEndpoints(
  db: D1Database,
  storage: R2Bucket,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  const headers = { 'Cache-Control': 'private, no-store' }
  const signedIn = (req: PayloadRequest) => !!req.user && req.user.collection === 'users'
  const sameOrigin = (req: PayloadRequest) =>
    !req.headers.get('origin') || req.headers.get('origin') === new URL(req.url!).origin
  const fromURL = (req: PayloadRequest) => {
    const query = new URL(req.url!).searchParams
    return {
      site: query.get('site') || '',
      link: crmRecordLink(query.get('recordType'), query.get('recordID')),
      id: query.get('id') || '',
      query,
    }
  }
  return [
    {
      path: '/crm/attachments',
      method: 'get',
      handler: async (req) => {
        if (!signedIn(req))
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        try {
          const input = fromURL(req)
          const result = await new CRMAttachments(db, storage, Number(req.user!.id)).list({
            ...input,
            archived: input.query.get('archived') === 'true',
            beforeDate: input.query.get('beforeDate') || undefined,
            beforeID: input.query.get('beforeID') || undefined,
          })
          return Response.json(result, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/attachments',
      method: 'post',
      handler: async (req) => {
        if (!signedIn(req))
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        if (!sameOrigin(req))
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403, headers },
          )
        try {
          const body = await readBoundedJSON(req, 8000),
            repo = new CRMAttachments(db, storage, Number(req.user!.id))
          const input = {
            site: String(body.site || ''),
            link: crmRecordLink(body.recordType, body.recordID),
            operationKey: String(body.operationKey || ''),
          }
          let doc: Record<string, unknown>
          if (body.action === 'stage') {
            if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values))
              throw new Error('Enter attachment metadata.')
            doc = await repo.stage({ ...input, values: body.values as Record<string, unknown> })
          } else if (
            body.action === 'archive' ||
            body.action === 'restore' ||
            body.action === 'cancel'
          )
            doc = await repo.control({
              ...input,
              id: String(body.id || ''),
              action: body.action,
              expectedRevision: Number(body.expectedRevision),
            })
          else throw new Error('Choose a supported attachment action.')
          return Response.json({ doc }, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/attachments/content',
      method: 'put',
      handler: async (req) => {
        if (!signedIn(req))
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        if (!sameOrigin(req))
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403, headers },
          )
        try {
          if (!req.body) throw new Error('Enter attachment file data.')
          const input = fromURL(req)
          const doc = await new CRMAttachments(db, storage, Number(req.user!.id)).upload({
            ...input,
            body: req.body,
            expectedRevision: Number(req.headers.get('x-crm-revision')),
            operationKey: req.headers.get('x-crm-operation-key') || '',
          })
          return Response.json({ doc }, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/attachments/content',
      method: 'get',
      handler: async (req) => {
        if (!signedIn(req))
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        try {
          return await new CRMAttachments(db, storage, Number(req.user!.id)).download(fromURL(req))
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
