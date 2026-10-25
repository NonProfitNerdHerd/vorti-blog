import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { EmailConfiguration } from './email-configuration'
import { EmailProviderError, type EmailRuntime } from './email-provider'
export function emailSettingsEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
  runtime: EmailRuntime = { environment: 'development', local: true, liveSendingEnabled: false },
): Endpoint[] {
  const failure = (error: unknown) =>
    error instanceof EmailProviderError
      ? Response.json(
          { message: error.message },
          {
            status: error.kind === 'unconfigured' ? 503 : 400,
            headers: { 'Cache-Control': 'private, no-store' },
          },
        )
      : errorResponse(error)
  return [
    {
      path: '/crm/email-settings',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          return Response.json(
            await new EmailConfiguration(db, Number(req.user.id), runtime).get(
              new URL(req.url!).searchParams.get('site') || '',
            ),
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: '/crm/email-settings',
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
            config = new EmailConfiguration(db, Number(req.user.id), runtime),
            common = {
              site: String(body.site || ''),
              expectedRevision: Number(body.expectedRevision),
              operationKey: String(body.operationKey || ''),
            }
          let doc: Record<string, unknown>
          if (body.action === 'verify-settings') doc = await config.verify(common)
          else if (
            body.action === 'save-settings' &&
            body.values &&
            typeof body.values === 'object' &&
            !Array.isArray(body.values)
          )
            doc = await config.save({ ...common, values: body.values as Record<string, unknown> })
          else throw new Error('Choose a valid email configuration action.')
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return failure(error)
        }
      },
    },
  ]
}
