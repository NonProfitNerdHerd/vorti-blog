import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { CorrespondenceRepository } from './correspondence'
import { CorrespondenceDocuments } from './correspondence-documents'
export function correspondenceEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
  storage?: R2Bucket,
): Endpoint[] {
  return [
    {
      path: '/crm/correspondence',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!)
          if (url.searchParams.get('view') === 'generation')
            return Response.json(
              await new CorrespondenceDocuments(db, Number(req.user.id)).generation(
                url.searchParams.get('site') || '',
                url.searchParams.get('document') || '',
              ),
              { headers: { 'Cache-Control': 'private, no-store' } },
            )
          if (url.searchParams.get('view') === 'sources')
            return Response.json(
              await new CorrespondenceDocuments(db, Number(req.user.id)).sources(
                url.searchParams.get('site') || '',
                url.searchParams.get('contact') || '',
                url.searchParams.get('kind') || '',
                url.searchParams.get('after') || '',
              ),
              { headers: { 'Cache-Control': 'private, no-store' } },
            )
          if (url.searchParams.get('view') === 'documents')
            return Response.json(
              await new CorrespondenceDocuments(db, Number(req.user.id)).list(
                url.searchParams.get('site') || '',
                url.searchParams.get('contact') || '',
                url.searchParams.get('beforeDate') || '',
                url.searchParams.get('beforeID') || '',
              ),
              { headers: { 'Cache-Control': 'private, no-store' } },
            )
          if (url.searchParams.has('document')) {
            const documents = new CorrespondenceDocuments(db, Number(req.user.id)),
              site = url.searchParams.get('site') || '',
              id = url.searchParams.get('document') || ''
            if (url.searchParams.get('format') === 'pdf') {
              if (!storage)
                return Response.json(
                  { message: 'This private document storage is not configured.' },
                  { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
                )
              const { privateDocumentPDF } = await import('./correspondence-job')
              return await privateDocumentPDF(db, storage, Number(req.user.id), site, id)
            }
            if (url.searchParams.get('format') === 'html')
              return new Response(await documents.printable(site, id), {
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'private, no-store',
                  'Content-Security-Policy':
                    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox allow-same-origin allow-modals",
                  'X-Content-Type-Options': 'nosniff',
                },
              })
            return Response.json(
              { doc: await documents.get(site, id) },
              { headers: { 'Cache-Control': 'private, no-store' } },
            )
          }
          return Response.json(
            await new CorrespondenceRepository(db, Number(req.user.id)).templates(
              url.searchParams.get('site') || '',
              url.searchParams.get('after') || '',
              url.searchParams.get('archived') === 'true',
            ),
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/correspondence',
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
          if (body.action === 'retry-generation' || body.action === 'cancel-generation') {
            const doc = await new CorrespondenceDocuments(
              db,
              Number(req.user.id),
            ).controlGeneration({
              site: String(body.site || ''),
              document: String(body.document || ''),
              job: String(body.job || ''),
              expectedFence: Number(body.expectedFence),
              action: body.action === 'retry-generation' ? 'retry' : 'cancel',
              operationKey: String(body.operationKey || ''),
            })
            return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
          }
          if (body.action === 'preview-document' || body.action === 'issue-document') {
            const request = {
              site: String(body.site || ''),
              contact: String(body.contact || ''),
              template: String(body.template || ''),
              issuedOn: String(body.issuedOn || ''),
              issuerName: String(body.issuerName || ''),
              issuerAddress: String(body.issuerAddress || ''),
              supersedes:
                typeof body.supersedes === 'string' && body.supersedes
                  ? body.supersedes
                  : undefined,
              gift: typeof body.gift === 'string' && body.gift ? body.gift : undefined,
              year: typeof body.year === 'number' ? body.year : undefined,
              membership:
                typeof body.membership === 'string' && body.membership
                  ? body.membership
                  : undefined,
            }
            const documents = new CorrespondenceDocuments(db, Number(req.user.id))
            const doc =
              body.action === 'preview-document'
                ? await documents.preview(request)
                : await documents.issue({
                    ...request,
                    approval: String(body.approval || ''),
                    operationKey: String(body.operationKey || ''),
                    supersedes:
                      typeof body.supersedes === 'string' && body.supersedes
                        ? body.supersedes
                        : undefined,
                  })
            return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
          }
          if (
            body.action !== 'save-template' ||
            !body.values ||
            typeof body.values !== 'object' ||
            Array.isArray(body.values)
          )
            throw new Error('Choose valid correspondence template values.')
          const doc = await new CorrespondenceRepository(db, Number(req.user.id)).saveTemplate({
            site: String(body.site || ''),
            id: typeof body.id === 'string' ? body.id : undefined,
            expectedRevision:
              typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
            operationKey: String(body.operationKey || ''),
            values: body.values as Record<string, unknown>,
          })
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
