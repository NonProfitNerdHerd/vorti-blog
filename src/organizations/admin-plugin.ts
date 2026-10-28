import { saveWebsiteSettings } from './website-settings'
import { cmsSiteContext } from './cms-scope'
import { initializeWebsite } from './website-copy'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { WebsiteRepository } from './websites'
import { APIError, type Config, type PayloadRequest } from 'payload'
import { readBoundedJSON } from '../forms/security'
import { errorResponse } from '../crm/plugin'
import { OrganizationRepository } from './repository'
import { cmsDatabase } from './cms-scope'
import { claimRequest } from './identity-authority'
import { AUTHORITY_MUTATION_COMMITTED } from './authority-plugin'
import { CMS_AUDIENCE } from '../publishing/readership'
import { TenantRepository } from './tenant-repository'
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
              if (site && params.has('websiteChoices')) {
                await repo.require(site, 'content', 'read')
                const tenant = new TenantRepository(cmsDatabase(req), Number(req.user!.id))
                await tenant.require(site, 'administration:settings')
                const result: Record<string, unknown> = {}
                for (const audience of ['public', 'intranet'] as const) {
                  if (audience === 'intranet') {
                    try { await tenant.require(site, 'intranet:read') }
                    catch (error) {
                      if (Number((error as { status?: number }).status) !== 403) throw error
                      continue
                    }
                  }
                  for (const collection of ['pages', 'media', 'site-templates', 'menus'] as const) {
                  const data = await req.payload.find({
                    collection,
                    req: { ...req, context: { ...cmsSiteContext(site), [CMS_AUDIENCE]: audience } },
                    depth: 0,
                    limit: 100,
                    ...(collection === 'pages' ? { where: { _status: { equals: 'published' as const } } } : {}),
                    overrideAccess: false,
                  })
                  result[audience === 'intranet' ? `intranet:${collection}` : collection] = data.docs.map((doc) => ({
                    id: doc.id,
                    label:
                      'title' in doc
                        ? doc.title
                        : 'name' in doc
                          ? doc.name
                          : 'alt' in doc
                            ? doc.alt
                            : String((doc as { id: number }).id),
                  }))
                  }
                }
                return Response.json(result, { headers })
              }
              if (site && params.has('website'))
                return Response.json(
                  await new WebsiteRepository(cmsDatabase(req), Number(req.user!.id)).status(site),
                  { headers },
                )
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
                case 'website-settings':
                  result = await saveWebsiteSettings(req, { ...base, settings: body.settings })
                  break
                case 'initialize-website':
                  result = await initializeWebsite(
                    req,
                    site,
                    (await getCloudflareContext({ async: true })).env.R2,
                    expectedRevision,
                  )
                  break
                case 'subsites':
                case 'publication':
                  result = await new WebsiteRepository(
                    cmsDatabase(req),
                    Number(req.user!.id),
                  ).update({
                    ...base,
                    action: body.action,
                    enabled: body.enabled as boolean,
                    confirmedDescendants: body.confirmedDescendants as number,
                  })
                  break
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
                    routeKey: typeof body.routeKey === 'string' ? body.routeKey : undefined,
                    name: String(body.name || ''),
                    expectedRevision,
                    operationKey,
                  })
                  try {
                    await initializeWebsite(
                      req,
                      String(result.site),
                      (await getCloudflareContext({ async: true })).env.R2,
                    )
                  } catch {
                    // Creation has committed even when a dependency copy fails.
                    // Acknowledge that audited mutation only while the actor still
                    // has current authority to maintain the parent and new child.
                    await repo.require(site, 'content', 'configure')
                    await repo.require(String(result.site), 'content', 'configure')
                    ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
                    return Response.json(
                      {
                        doc: result,
                        initializationError:
                          'Child site created unpublished. Its design copy did not finish; select Initialize website to retry safely.',
                      },
                      { status: 201, headers },
                    )
                  }
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
              Component: './organizations/AdminWorkspaces#SitesCompatibilityView',
              path: '/sites',
            },
          },
        },
      },
    }
  }
