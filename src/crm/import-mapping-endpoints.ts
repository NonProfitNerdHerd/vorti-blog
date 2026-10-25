import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { ImportMappings } from './import-mappings'

export function importMappingEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  const headers = { 'Cache-Control': 'private, no-store' }
  return [
    {
      path: '/crm/import-mappings',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401, headers })
        try {
          const params = new URL(req.url!).searchParams,
            repository = new ImportMappings(db, Number(req.user.id)),
            site = params.get('site') || '',
            domain = params.get('domain')
          if (params.has('archived') && !['true', 'false'].includes(params.get('archived')!))
            throw new Error('Choose a valid mapping archive filter.')
          return Response.json(
            params.has('id')
              ? { doc: await repository.get(site, domain, params.get('id') || '') }
              : await repository.list({
                  site,
                  domain,
                  after: params.get('after') || '',
                  archived: params.get('archived') === 'true',
                }),
            { headers },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/import-mappings',
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
          const body = await readBoundedJSON(req, 1048576)
          if (body.action !== 'save') throw new Error('Choose a supported mapping action.')
          const doc = await new ImportMappings(db, Number(req.user.id)).save({
            site: String(body.site || ''),
            domain: body.domain,
            id: body.id as string | undefined,
            expectedRevision: body.expectedRevision as number | undefined,
            name: body.name,
            mapping: body.mapping,
            archived: body.archived,
            operationKey: String(body.operationKey || ''),
          })
          return Response.json({ doc }, { headers })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
