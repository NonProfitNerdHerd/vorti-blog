import type { Config, Endpoint } from 'payload'
import { ContactRepository } from './contacts'
import { OrganizationRepository } from '../organizations/repository'
import type { ConstituentRole } from './contact-model'
import { readBoundedJSON } from '../forms/security'
import { financeEndpoints } from './finance-endpoints'

export interface CRMPlatform {
  db: D1Database
  storage: R2Bucket
}
export function errorResponse(error: unknown): Response {
  if (error instanceof Error && /no such table:.*vc_/i.test(error.message))
    return Response.json(
      { message: 'CRM database migrations are pending. Contact an installation operator.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    )
  const status =
    typeof error === 'object' && error && 'status' in error ? Number(error.status) : 400
  const safeMessage =
    error instanceof Error &&
    /^(Enter|Choose|Use|Remove|Confirm|Create a separate|This site|This record|Search|Invalid page)/.test(
      error.message,
    )
      ? error.message
      : 'The operation could not be completed. Review your input and try again.'
  return Response.json(
    { message: safeMessage },
    {
      status: [400, 401, 403, 404, 409, 413, 415, 503].includes(status) ? status : 500,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  )
}
/** Authenticated module endpoints. Register only after the contact migration is applied. */
export const crmModule =
  (platform: CRMPlatform) =>
  (config: Config): Config => {
    const contacts: Endpoint = {
      path: '/crm/contacts',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const url = new URL(req.url!),
            site = url.searchParams.get('site') || 'default'
          const repository = new ContactRepository(platform.db, Number(req.user.id))
          const id = url.searchParams.get('id')
          if (id && url.searchParams.get('view') === 'corrections')
            return Response.json(
              await repository.corrections({
                site,
                id,
                before: url.searchParams.has('beforeID')
                  ? {
                      id: url.searchParams.get('beforeID') || '',
                      createdAt: url.searchParams.get('beforeDate') || '',
                    }
                  : undefined,
              }),
              { headers: { 'Cache-Control': 'private, no-store' } },
            )
          if (id)
            return Response.json(
              { doc: await repository.get(site, id) },
              { headers: { 'Cache-Control': 'private, no-store' } },
            )
          const afterID = url.searchParams.get('afterID'),
            afterLabel = url.searchParams.get('afterLabel')
          const result = await repository.list({
            site,
            search: url.searchParams.get('search') || '',
            role: (url.searchParams.get('role') || undefined) as ConstituentRole | undefined,
            limit: Number(url.searchParams.get('limit') || 50),
            after: afterID && afterLabel !== null ? { id: afterID, label: afterLabel } : undefined,
          })
          return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
        } catch (error) {
          return errorResponse(error)
        }
      },
    }
    const mutations: Endpoint = {
      path: '/crm/contacts',
      method: 'post',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        const origin = req.headers.get('origin')
        if (origin && origin !== new URL(req.url!).origin)
          return Response.json(
            { message: 'Use the signed-in site to save changes.' },
            { status: 403 },
          )
        try {
          const body = await readBoundedJSON(req, 32000)
          const repository = new ContactRepository(platform.db, Number(req.user.id))
          const context = {
            site: String(body.site || ''),
            operationKey: String(body.operationKey || ''),
          }
          let result: Record<string, unknown>
          if (body.action === 'create')
            result = await repository.create({
              ...context,
              profile: body.profile,
              roles: body.roles,
              tags: body.tags,
            })
          else if (body.action === 'update-profile')
            result = await repository.updateProfile({
              ...context,
              id: String(body.id || ''),
              expectedRevision: Number(body.expectedRevision),
              confirmedSharedUpdate: body.confirmedSharedUpdate === true,
              profile: body.profile,
            })
          else if (body.action === 'update-chapter')
            result = await repository.updateChapter({
              ...context,
              id: String(body.id || ''),
              expectedRevision: Number(body.expectedRevision),
              roles: body.roles,
              tags: body.tags,
            })
          else if (body.action === 'resolve-correction')
            result = await repository.resolveCorrection({
              ...context,
              id: String(body.id || ''),
              correction: String(body.correction || ''),
              expectedRevision: Number(body.expectedRevision),
              status: body.status as 'resolved' | 'declined',
              reason: typeof body.reason === 'string' ? body.reason : '',
            })
          else if (body.action === 'request-correction')
            result = await repository.requestCorrection({
              ...context,
              id: String(body.id || ''),
              message: typeof body.message === 'string' ? body.message : '',
            })
          else
            return Response.json({ message: 'Choose a supported contact action.' }, { status: 400 })
          return Response.json(
            { doc: result },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    }
    const context: Endpoint = {
      path: '/crm/context',
      method: 'get',
      handler: async (req) => {
        if (!req.user || req.user.collection !== 'users')
          return Response.json({ message: 'Sign in to use CRM.' }, { status: 401 })
        try {
          const authority = new OrganizationRepository(platform.db, Number(req.user.id))
          const selected = (req.url ? new URL(req.url).searchParams.get('site') : null) || (await authority.context()).site
          const site = await authority.require(selected, 'identity', 'read')
          return Response.json(
            {
              site: { id: site.id, name: site.name },
              canCreate: (await authority.authority(site.id, 'identity', 'edit')).allowed,
            },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    }
    return {
      ...config,
      endpoints: [
        ...(config.endpoints || []),
        contacts,
        mutations,
        context,
        ...financeEndpoints(platform.db, errorResponse),
      ],
      admin: {
        ...config.admin,
        components: {
          ...config.admin?.components,
          views: {
            ...config.admin?.components?.views,
            crm: { Component: './organizations/AdminWorkspaces#CRMAdminView', path: '/crm' },
          },
        },
      },
    }
  }
