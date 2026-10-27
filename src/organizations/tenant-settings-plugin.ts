import { APIError, type Config, type PayloadRequest } from 'payload'
import { cmsDatabase } from './cms-scope'
import { claimRequest } from './identity-authority'
import { TenantRepository } from './tenant-repository'
import { ScopedSettingsRepository } from './scoped-settings'
import { effectiveFeature, canDelegate } from './tenant-policy'
import { tenantAuthorityActive } from './tenant-runtime'
import { applicationFeatures, type ApplicationFeature, type Permission } from './permission-catalog'
import { readBoundedJSON } from '../forms/security'
import { errorResponse } from '../crm/plugin'
import { AUTHORITY_MUTATION_COMMITTED } from './authority-plugin'
import { InvitationRepository } from './invitations'

const headers = { 'Cache-Control': 'private, no-store' }
function settingsError(error: unknown) {
  if (error instanceof Error && /last active Tenant Administrator/i.test(error.message))
    return Response.json(
      {
        message:
          'Keep at least one active Tenant Administrator. Assign another administrator before removing or suspending this one.',
      },
      { status: 409, headers },
    )
  return errorResponse(error)
}
async function context(req: PayloadRequest, site: string) {
  if (!req.user || req.user.collection !== 'users')
    throw new APIError('Sign in to manage settings.', 401)
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(site)) throw new APIError('Choose a valid site.', 400)
  const db = cmsDatabase(req)
  if (!(await tenantAuthorityActive(db, site)))
    throw new APIError('Tenant installation is not activated.', 503)
  await claimRequest(req, site)
  return {
    db,
    roles: new TenantRepository(db, Number(req.user.id)),
    settings: new ScopedSettingsRepository(db, Number(req.user.id)),
  }
}
export const tenantSettingsAdministration = (config: Config): Config => ({
  ...config,
  endpoints: [
    ...(config.endpoints || []),
    {
      path: '/tenant-settings',
      method: 'get',
      handler: async (req) => {
        try {
          const params = new URL(req.url!).searchParams,
            site = params.get('site') || 'default'
          const { db, roles, settings } = await context(req, site)
          const section = params.get('section') || 'site'
          if (section === 'site' || section === 'tenant')
            return Response.json(await settings.read(site, section), { headers })
          if (!['roles', 'features', 'members'].includes(section))
            throw new APIError('Choose a valid settings section.', 400)
          const authority = await roles.require(
            site,
            section === 'roles'
              ? 'administration:roles'
              : section === 'members'
                ? 'administration:assignments'
                : 'administration:features',
          )
          const snapshot = await roles.snapshot(site)
          if (snapshot.revision !== authority.revision)
            throw new APIError('Permissions changed. Reload settings.', 409)
          if (section === 'members') {
            const [members, assignments] = await Promise.all([
              db
                .prepare(
                  'SELECT m.user_id AS id,u.email,m.active FROM vc_tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.email',
                )
                .bind(authority.tenant)
                .all<{ id: number; email: string; active: number }>(),
              db
                .prepare(
                  'SELECT a.id,a.user_id AS user,a.role_id AS role,a.site_id AS site,a.descendants,r.name AS roleName,r.builtin,r.retired FROM vc_tenant_assignments a JOIN vc_tenant_roles r ON r.id=a.role_id WHERE a.tenant_id=? ORDER BY a.user_id,r.name',
                )
                .bind(authority.tenant)
                .all<{
                  id: string
                  user: number
                  role: string
                  site: string | null
                  descendants: number
                  roleName: string
                  builtin: string | null
                  retired: number
                }>(),
            ])
            const scopes = snapshot.policy.sites
              .filter((node) =>
                canDelegate(snapshot.policy, {
                  site: node.id,
                  descendants: false,
                  permissions: ['administration:assignments'],
                }),
              )
              .map((node) => node.id)
            const tenantScope = canDelegate(snapshot.policy, {
              site: null,
              descendants: true,
              permissions: ['administration:tenant-administrators'],
            })
            await roles.assertRevision(authority.tenant, authority.revision)
            return Response.json(
              {
                revision: authority.revision,
                members: members.results,
                scopes,
                tenantScope,
                assignments: assignments.results.filter(
                  (row) => tenantScope || (row.site !== null && scopes.includes(row.site)),
                ),
              },
              { headers },
            )
          }
          if (section === 'features')
            return Response.json(
              {
                revision: snapshot.revision,
                tenant: authority.tenant,
                features: applicationFeatures.map((feature) => ({
                  feature,
                  tenantAvailable: snapshot.features.available[feature],
                  ...effectiveFeature(snapshot.features, site, feature),
                })),
              },
              { headers },
            )
          const records = (
            await db
              .prepare(
                'SELECT id,name,description,builtin,retired,revision FROM vc_tenant_roles WHERE tenant_id=? ORDER BY builtin IS NULL,name,id',
              )
              .bind(authority.tenant)
              .all<{
                id: string
                name: string
                description: string
                builtin: string | null
                retired: number
                revision: number
              }>()
          ).results
          await roles.assertRevision(authority.tenant, authority.revision)
          return Response.json(
            {
              revision: authority.revision,
              tenant: authority.tenant,
              roles: records.map((role) => ({
                ...role,
                permissions:
                  snapshot.policy.roles.find((definition) => definition.id === role.id)
                    ?.permissions ?? [],
              })),
            },
            { headers },
          )
        } catch (error) {
          return settingsError(error)
        }
      },
    },
    {
      path: '/tenant-settings',
      method: 'post',
      handler: async (req) => {
        try {
          if (req.headers.get('origin') !== new URL(req.url!).origin)
            throw new APIError('Use the signed-in site to save settings.', 403)
          const body = await readBoundedJSON(req, 64000)
          const site = typeof body.site === 'string' ? body.site : ''
          const { db, roles, settings } = await context(req, site)
          const revision = Number(body.expectedRevision),
            key = typeof body.operationKey === 'string' ? body.operationKey : ''
          if (
            !Number.isSafeInteger(revision) ||
            revision < 0 ||
            !/^[a-zA-Z0-9_-]{16,128}$/.test(key)
          )
            throw new APIError('Reload a valid settings revision before saving.', 400)
          const base = { site, id: String(body.id || ''), expectedAuthorityRevision: revision, key }
          let result: unknown
          switch (body.action) {
            case 'invite': {
              if(typeof body.email!=='string')throw new APIError('Enter an invitation email.',400)
              const invitation=await new InvitationRepository(db).issue(Number(req.user!.id),site,body.email,key)
              result={...invitation,link:new URL(`/join#${invitation.token}`,req.url!).toString()}
              break
            }
            case 'settings':
              result = await settings.save({
                site,
                scope: body.scope === 'tenant' ? 'tenant' : 'site',
                settings: body.settings,
                expectedRevision: revision,
                operationKey: key,
              })
              break
            case 'role-save':
              result = await roles.saveRole({
                ...base,
                name: String(body.name || ''),
                description: String(body.description || ''),
                permissions: body.permissions as Permission[],
              })
              break
            case 'role-retire':
              result = await roles.retireRole(base)
              break
            case 'role-assign':
              if (
                typeof body.descendants !== 'boolean' ||
                !(body.assignmentSite === null || typeof body.assignmentSite === 'string')
              )
                throw new APIError('Choose an assignment scope.', 400)
              result = await roles.assignRole({
                ...base,
                contextSite: site,
                user: Number(body.user),
                role: String(body.role || ''),
                site: body.assignmentSite as string | null,
                descendants: body.descendants,
              })
              break
            case 'role-remove':
              result = await roles.removeAssignment({ ...base, contextSite: site })
              break
            case 'member-active':
              if (typeof body.active !== 'boolean')
                throw new APIError('Choose an active membership state.', 400)
              result = await roles.setMemberActive({
                ...base,
                contextSite: site,
                user: Number(body.user),
                active: body.active,
              })
              break
            case 'feature':
              if (!(body.featureSite === null || body.featureSite === site))
                throw new APIError('Choose the current site or tenant scope.', 400)
              result = await roles.setFeature({
                ...base,
                contextSite: site,
                site: body.featureSite as string | null,
                feature: body.feature as ApplicationFeature,
                value: body.value as boolean | 'inherit' | 'enabled' | 'disabled',
              })
              break
            default:
              throw new APIError('Choose a supported settings operation.', 400)
          }
          ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
          return Response.json(result, { headers })
        } catch (error) {
          return settingsError(error)
        }
      },
    },
  ],
})
