import { APIError, type Config, type PayloadRequest } from 'payload'
import { CMS_MENU_RENDER, CMS_SITE, cmsScope, confirmCMSScope, migrationRequest } from './cms-scope'
import { installationOperator } from './users-plugin'

async function requireGlobalWrite(req: PayloadRequest, slug: string): Promise<void> {
  if (migrationRequest(req)) return
  if (slug === 'system-settings') {
    if (!(await installationOperator(req)))
      throw new APIError('Only installation operators can change platform settings.', 403)
    ;(req.context as Record<symbol, unknown>)[CMS_SITE] = 'default'
    return
  }
  const scope = await cmsScope(req, slug === 'navigation' ? 'edit' : 'configure')
  if (scope.site !== 'default')
    throw new APIError(
      'Use this site’s settings instead of changing the installation’s default site.',
      403,
    )
  await confirmCMSScope(req, scope)
}
/** Preserve root Global APIs. Another site's active context must never overwrite root settings. */
export const tenantGlobals = (config: Config): Config => ({
  ...config,
  globals: (config.globals || []).map((global) => {
    if (!['navigation', 'site-settings', 'system-settings'].includes(global.slug)) return global
    const update = global.access?.update
    return {
      ...global,
      fields: [
        ...global.fields,
        {
          name: 'platformGlobalProof',
          type: 'json',
          admin: { hidden: true },
          access: { read: () => false, update: () => false },
        },
      ],
      ...(global.slug === 'system-settings'
        ? { admin: { ...global.admin, hidden: ({ user }) => user?.platformOperator !== true } }
        : {}),
      access: {
        ...global.access,
        ...(global.slug === 'navigation'
          ? {
              read: async ({ req }) => {
                if (!req.user && (req.context as Record<symbol, unknown>)[CMS_MENU_RENDER] !== true)
                  return false
                try {
                  const scope = await cmsScope(req, 'read')
                  return scope.site === 'default'
                } catch {
                  return false
                }
              },
            }
          : {}),
        update: async (args) => {
          try {
            await requireGlobalWrite(args.req, global.slug)
          } catch {
            return false
          }
          return global.slug === 'system-settings'
            ? true
            : update
              ? update(args)
              : Boolean(args.req.user)
        },
      },
      hooks: {
        ...global.hooks,
        beforeRead: [
          async ({ req }) => {
            if (migrationRequest(req)) return
            if (global.slug === 'navigation' && (await cmsScope(req, 'read')).site !== 'default')
              throw new APIError('Use the active site’s menu workspace.', 403)
          },
          ...(global.hooks?.beforeRead || []),
        ],
        beforeChange: [
          async ({ req, data }) => {
            await requireGlobalWrite(req, global.slug)
            return data
          },
          ...(global.hooks?.beforeChange || []),
          async ({ req, data }) => {
            await requireGlobalWrite(req, global.slug)
            if (migrationRequest(req)) return { ...data, platformGlobalProof: null }
            const scope = await cmsScope(req, global.slug === 'navigation' ? 'edit' : 'configure')
            if (scope.bootstrap) return { ...data, platformGlobalProof: null }
            await confirmCMSScope(req, scope)
            return {
              ...data,
              platformGlobalProof: {
                actor: scope.actor,
                epoch: scope.epoch,
                nonce: crypto.randomUUID(),
              },
            }
          },
        ],
        afterRead: [
          ...(global.hooks?.afterRead || []),
          async ({ doc, req }) => {
            if (doc && typeof doc === 'object') delete doc.platformGlobalProof
            if (global.slug === 'navigation' && !migrationRequest(req))
              await confirmCMSScope(req, await cmsScope(req, 'read'))
            return doc
          },
        ],
      },
    }
  }),
})
