import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { CommentRepository } from './comments'

export function commentEndpoints(db: D1Database, errorResponse: (error: unknown) => Response): Endpoint[] {
  return [
    { path: '/crm/comments', method: 'get', handler: async req => {
      if (!req.user || req.user.collection !== 'users') return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
      try {
        const params = new URL(req.url!).searchParams
        return Response.json(await new CommentRepository(db, Number(req.user.id)).list(params.get('site') || '', params.get('contact') || '', params.get('beforeDate') || '', params.get('beforeID') || ''),
          { headers: { 'Cache-Control': 'private, no-store' } })
      } catch (error) { return errorResponse(error) }
    } },
    { path: '/crm/comments', method: 'post', handler: async req => {
      if (!req.user || req.user.collection !== 'users') return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
      if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url!).origin)
        return Response.json({ message: 'Use the signed-in site to save changes.' }, { status: 403 })
      try {
        const body = await readBoundedJSON(req, 6000)
        const user = req.user as typeof req.user & { attributionLabel?: string; displayName?: string; username?: string }
        const author = user.attributionLabel || user.displayName || user.username || 'Staff member'
        return Response.json(await new CommentRepository(db, Number(req.user.id), author).save({
          site: String(body.site || ''), contact: String(body.contact || ''), body: body.body as string,
          id: typeof body.id === 'string' ? body.id : undefined,
          expectedRevision: typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
          operationKey: String(body.operationKey || ''),
        }), { headers: { 'Cache-Control': 'private, no-store' } })
      } catch (error) { return errorResponse(error) }
    } },
  ]
}
