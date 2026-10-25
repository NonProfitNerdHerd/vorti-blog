import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { EmailOutbox } from './email-outbox'
import { EmailReconciler } from './email-reconciliation'
import { EmailProviderError, type EmailRuntime } from './email-provider'
export function emailDeliveryEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
  runtime: EmailRuntime = { environment: 'development', local: true, liveSendingEnabled: false },
): Endpoint[] {
  const failure = (error: unknown) =>
    error instanceof EmailProviderError
      ? Response.json(
          { message: error.message },
          {
            status: ['unconfigured', 'uncertain'].includes(error.kind) ? 503 : 400,
            headers: { 'Cache-Control': 'private, no-store' },
          },
        )
      : errorResponse(error)
  return [
    {
      path: '/crm/email-deliveries',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!),
            outbox = new EmailOutbox(db, Number(req.user.id), runtime)
          const site = url.searchParams.get('site') || '',
            id = url.searchParams.get('id')
          if (url.searchParams.get('view') === 'events')
            return Response.json(
              await outbox.events(
                site,
                id || '',
                url.searchParams.get('beforeDate') || '',
                url.searchParams.get('beforeID') || '',
              ),
              { headers: { 'Cache-Control': 'private, no-store' } },
            )
          return Response.json(
            id
              ? { doc: await outbox.get(site, id) }
              : await outbox.context(site, url.searchParams.get('document') || ''),
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: '/crm/email-deliveries',
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
          const body = await readBoundedJSON(req, 8000),
            actor = Number(req.user.id),
            outbox = new EmailOutbox(db, actor, runtime),
            site = String(body.site || '')
          let doc: unknown
          if (
            ['preview-email', 'queue-email'].includes(String(body.action)) &&
            typeof body.includePDF !== 'boolean'
          )
            throw new Error('Choose whether to attach the document PDF.')
          const input = {
            site,
            document: String(body.document || ''),
            recipient: String(body.recipient || ''),
            includePDF: body.includePDF === true,
          }
          if (body.action === 'preview-email') doc = await outbox.preview(input)
          else if (body.action === 'cancel-email' || body.action === 'retry-email')
            doc = await outbox.control({
              site,
              id: String(body.id || ''),
              expectedRevision: Number(body.expectedRevision),
              action: body.action === 'cancel-email' ? 'cancel' : 'retry',
              operationKey: String(body.operationKey || ''),
            })
          else if (body.action === 'queue-email')
            doc = await outbox.queue({
              ...input,
              approval: String(body.approval || ''),
              operationKey: String(body.operationKey || ''),
            })
          else if (body.action === 'reconcile-email')
            doc = await new EmailReconciler(db, actor, runtime).reconcile({
              site,
              id: String(body.id || ''),
              providerID: String(body.providerID || ''),
              expectedRevision: Number(body.expectedRevision),
              operationKey: String(body.operationKey || ''),
            })
          else throw new Error('Choose a supported email delivery action.')
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return failure(error)
        }
      },
    },
  ]
}
