import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { crmRecordLink } from './record-model'
import { CRMTasks } from './tasks'
import { crmTaskRecordPicker } from './task-record-picker'
export function crmTaskEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/tasks/records',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const params = new URL(req.url!).searchParams
          const result = await crmTaskRecordPicker(db, Number(req.user.id), params.get('site') || '', params.get('type'), params.get('search') || '')
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) { return errorResponse(error) }
      },
    },
    {
      path: '/crm/tasks',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const params = new URL(req.url!).searchParams,
            site = params.get('site') || '',
            link = crmRecordLink(params.get('type'), params.get('id')),
            service = new CRMTasks(db, req)
          const result =
            params.get('view') === 'people'
              ? await service.people(
                  site,
                  link,
                  params.get('search') || '',
                  Number(params.get('after') || 0),
                )
              : await service.list(
                  site,
                  link,
                  Number(params.get('page') || 1),
                  params.get('state') || 'open',
                  params.get('view') || 'list',
                )
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/tasks',
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
          const body = await readBoundedJSON(req, 32000)
          if (body.action !== 'create') throw new Error('Choose a supported CRM task action.')
          const doc = await new CRMTasks(db, req).create({
            site: String(body.site || ''),
            link: crmRecordLink(body.type, body.id),
            expectedRevision: Number(body.expectedRevision),
            expectedAuthorityRevision: Number(body.expectedAuthorityRevision),
            operationKey: String(body.operationKey || ''),
            title: body.title as string,
            description: body.description as string,
            assignee: body.assignee == null ? null : Number(body.assignee),
            dueOn: body.dueOn as string,
            activity: body.activity as string,
          })
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
