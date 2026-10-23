import { APIError, type Config, type PayloadRequest } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { errorResponse } from '../crm/plugin'
import { OrganizationRepository } from './repository'
import { cmsDatabase } from './cms-scope'
import { claimRequest } from './identity-authority'
import { AUTHORITY_MUTATION_COMMITTED } from './authority-plugin'
import type { InformationCategory, SiteOperation, SiteRole } from './policy'

function repository(req: PayloadRequest) {
  if (!req.user || req.user.collection !== 'users')
    throw new APIError('Sign in to manage sites.', 401)
  return new OrganizationRepository(cmsDatabase(req), Number(req.user.id))
}
const headers = { 'Cache-Control': 'private, no-store' }

/** Registered only for isolated review or an explicitly enabled production release. */
export const organizationAdministration =
  ({ enabled }: { enabled: boolean }) =>
  (config: Config): Config => {
    if (!enabled) return config
    return {
      ...config,
      endpoints: [
        ...(config.endpoints || []),
        {
          path: '/organization-admin',
          method: 'get',
          handler: async (req) => {
            try {
              const repo = repository(req),
                params = new URL(req.url!).searchParams
              const context = await repo.context()
              const site = params.get('site')
              if (site && params.has('settings'))
                return Response.json(await repo.settings(site), { headers })
              if (site && params.has('user'))
                return Response.json(
                  await repo.memberRestrictions(site, Number(params.get('user'))),
                  { headers },
                )
              if (site)
                return Response.json(
                  await repo.administration(
                    site,
                    Number(params.get('memberAfter') || 0),
                    params.get('grantAfter') || '',
                  ),
                  { headers },
                )
              return Response.json(
                {
                  ...(await repo.listSites(params.get('after') || '')),
                  context,
                  operator: await repo.isOperator(),
                },
                { headers },
              )
            } catch (error) {
              return errorResponse(error)
            }
          },
        },
        {
          path: '/organization-admin',
          method: 'post',
          handler: async (req) => {
            try {
              const repo = repository(req)
              if (req.headers.get('origin') !== new URL(req.url!).origin)
                throw new APIError('Use the signed-in site to save changes.', 403)
              const body = await readBoundedJSON(req, 16000),
                site = typeof body.site === 'string' ? body.site : '',
                operationKey = typeof body.operationKey === 'string' ? body.operationKey : '',
                expectedRevision = Number(body.expectedRevision)
              if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
                throw new APIError('Reload the current revision before saving.', 400)
              // Site is explicit for this operation; the saved preference cannot retarget it.
              if (site) await claimRequest(req, site)
              const base = { site, expectedRevision, operationKey }
              let result: Record<string, unknown>
              switch (body.action) {
                case 'create-organization':
                  result = await repo.createOrganization({
                    name: String(body.name || ''),
                    siteName: String(body.siteName || ''),
                    operationKey,
                  })
                  break
                case 'create-site':
                  result = await repo.createSite({
                    parent: site,
                    name: String(body.name || ''),
                    expectedRevision,
                    operationKey,
                  })
                  break
                case 'membership':
                  result = await repo.setMembership({
                    ...base,
                    user: Number(body.user),
                    role: body.role as SiteRole,
                    active: body.active as boolean,
                  })
                  break
                case 'restrictions':
                  result = await repo.setRestrictions({
                    ...base,
                    user: Number(body.user),
                    denied: body.denied as Array<{
                      category: InformationCategory
                      operation: SiteOperation
                    }>,
                  })
                  break
                case 'policy':
                  result = await repo.setPolicy({
                    ...base,
                    category: body.category as InformationCategory,
                    operation: body.operation as SiteOperation,
                    descendantsAllowed: body.descendantsAllowed as boolean,
                    overseeDescendants: body.overseeDescendants as boolean,
                  })
                  break
                case 'sharing':
                  result = await repo.setSharing({
                    ...base,
                    receiver: String(body.receiver || ''),
                    category: body.category as InformationCategory,
                    operation: body.operation as SiteOperation,
                    receiverDescendants: body.receiverDescendants as boolean,
                    revoked: body.revoked as boolean,
                  })
                  break
                case 'move-site':
                  result = await repo.moveSite({
                    ...base,
                    parent: String(body.parent || ''),
                    expectedParentRevision: Number(body.expectedParentRevision),
                  })
                  break
                case 'context':
                  result = await repo.setContext(base)
                  break
                case 'site-settings':
                  result = await repo.setSettings({ ...base, settings: body.settings })
                  break
                default:
                  throw new APIError('Choose a supported site action.', 400)
              }
              ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
              return Response.json({ doc: result }, { headers })
            } catch (error) {
              return errorResponse(error)
            }
          },
        },
      ],
      admin: {
        ...config.admin,
        components: {
          ...config.admin?.components,
          views: {
            ...config.admin?.components?.views,
            organizations: {
              Component: './organizations/OrganizationWorkspace#OrganizationWorkspace',
              path: '/sites',
            },
          },
        },
      },
    }
  }
