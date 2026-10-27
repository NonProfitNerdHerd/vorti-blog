import { APIError, createLocalReq, type Config, type PayloadRequest } from 'payload'
import { cmsDatabase, migrationRequest } from './cms-scope'
import { claimRequest } from './identity-authority'
import { tenantAuthorityActive } from './tenant-runtime'
import { ScopedSettingsRepository } from './scoped-settings'
import { AUTHORITY_MUTATION_COMMITTED } from './authority-plugin'
import { readBoundedJSON } from '../forms/security'
import { errorResponse } from '../crm/plugin'

/** Old global URLs and the Local API save through the same scoped CAS repository. */
export async function saveCompatibilitySettings(req: PayloadRequest, slug: string, input: unknown) {
  const claim = await claimRequest(req)
  if (!claim?.permissions) throw new APIError('Scoped settings are not activated.', 409)
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new APIError('Enter valid settings.', 400)
  const { platformSettingsRevision, operationKey, ...settings } = input as Record<string, unknown>
  if (
    !Number.isSafeInteger(platformSettingsRevision) ||
    Number(platformSettingsRevision) < 0 ||
    typeof operationKey !== 'string' ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(operationKey)
  )
    throw new APIError('Supply the current platformSettingsRevision and an operationKey.', 409)
  const tenant = slug === 'system-settings' && 'workspaceEmbedOrigins' in settings
  if (tenant && Object.keys(settings).length !== 1)
    throw new APIError('Save tenant embed origins separately from site settings.', 400)
  if (
    slug === 'system-settings' &&
    !tenant &&
    Object.keys(settings).some((key) => key !== 'categoriesEnabled')
  )
    throw new APIError('Manage tag permissions in Roles.', 400)
  const result = await new ScopedSettingsRepository(cmsDatabase(req), claim.actor).save({
    site: claim.site,
    scope: tenant ? 'tenant' : 'site',
    settings,
    expectedRevision: Number(platformSettingsRevision),
    operationKey,
  })
  ;(req.context as Record<symbol, unknown>)[AUTHORITY_MUTATION_COMMITTED] = true
  delete req.context.systemCategoriesEnabled
  return {
    ...(result.settings as Record<string, unknown>),
    platformSettingsRevision: result.revision,
  }
}

export const settingsCompatibility = (config: Config): Config => ({
  ...config,
  onInit: async (payload) => {
    const update = payload.updateGlobal.bind(payload)
    payload.updateGlobal = (async (options) => {
      if (['site-settings', 'system-settings'].includes(options.slug)) {
        const req = await createLocalReq(options, payload)
        if (!migrationRequest(req) && (await tenantAuthorityActive(cmsDatabase(req))))
          return saveCompatibilitySettings(req, options.slug, options.data)
      }
      return update(options)
    }) as typeof payload.updateGlobal
    await config.onInit?.(payload)
  },
  globals: (config.globals || []).map((global) =>
    !['site-settings', 'system-settings'].includes(global.slug)
      ? global
      : {
          ...global,
          fields: [
            ...global.fields,
            {
              name: 'platformSettingsRevision',
              type: 'number',
              virtual: true,
              admin: { hidden: true },
              access: { update: () => false },
            },
          ],
          endpoints: [
            {
              path: '/',
              method: 'post',
              handler: async (req) => {
                try {
                  if (req.headers.get('origin') !== new URL(req.url!).origin)
                    throw new APIError('Use the signed-in site to save settings.', 403)
                  const data = req.data || (await readBoundedJSON(req, 64000))
                  const result = await req.payload.updateGlobal({
                    slug: global.slug as 'site-settings' | 'system-settings',
                    data,
                    req,
                    overrideAccess: false,
                  })
                  return Response.json(
                    { result, message: 'Settings saved.' },
                    { headers: { 'Cache-Control': 'private, no-store' } },
                  )
                } catch (error) {
                  return errorResponse(error)
                }
              },
            },
            ...(global.endpoints || []),
          ],
        },
  ),
})
