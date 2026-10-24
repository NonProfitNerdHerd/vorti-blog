import type { Endpoint } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { VolunteerRepository } from './volunteers'
export function volunteerEndpoints(
  db: D1Database,
  errorResponse: (error: unknown) => Response,
): Endpoint[] {
  return [
    {
      path: '/crm/volunteers',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const p = new URL(req.url!).searchParams,
            site = p.get('site') || '',
            repo = new VolunteerRepository(db, Number(req.user.id)),
            view = p.get('view'),
            id = p.get('id') || '',
            contact = p.get('contact') || '',
            after = p.get('after') || '',
            archived = p.get('archived') === 'true'
          const result =
            view === 'profiles'
              ? await repo.profiles(
                  site,
                  p.get('search') || '',
                  after,
                  archived,
                  p.get('eligible') === 'true',
                  contact,
                )
              : view === 'profile'
                ? await repo.getProfile(site, id)
                : view === 'activities'
                  ? await repo.activities(site, after, archived, contact)
                  : view === 'activity'
                    ? await repo.getActivity(site, id, after)
                    : view === 'invitations'
                      ? await repo.invitations(site, p.get('activity') || '', contact, after)
                      : view === 'hours'
                        ? await repo.hours(
                            site,
                            p.get('activity') || '',
                            contact,
                            after,
                            p.get('state') || 'all',
                          )
                        : null
          if (!result) throw new Error('Choose a valid volunteer view.')
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
    {
      path: '/crm/volunteers',
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
          const b = await readBoundedJSON(req, 32000)
          if (!b.values || typeof b.values !== 'object' || Array.isArray(b.values))
            throw new Error('Enter valid volunteer values.')
          const repo = new VolunteerRepository(db, Number(req.user.id)),
            input = {
              site: String(b.site || ''),
              operationKey: String(b.operationKey || ''),
              id: typeof b.id === 'string' ? b.id : undefined,
              expectedRevision:
                typeof b.expectedRevision === 'number' ? b.expectedRevision : undefined,
              values: b.values as Record<string, unknown>,
            }
          const doc =
            b.action === 'save-profile'
              ? await repo.saveProfile(input)
              : b.action === 'save-activity'
                ? await repo.saveActivity(input)
                : b.action === 'participate'
                  ? await repo.participate(input)
                  : b.action === 'invite'
                    ? await repo.invite(input)
                    : b.action === 'respond'
                      ? await repo.respond(input)
                      : b.action === 'submit-hours'
                        ? await repo.submitHours(input)
                        : b.action === 'review-hours'
                          ? await repo.reviewHours(input)
                          : null
          if (!doc) throw new Error('Choose a valid volunteer action.')
          return Response.json({ doc }, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  ]
}
