import { APIError, type Config, type PayloadRequest } from 'payload'
import { scopedCMS } from './cms-collections'
import { guardedMutations } from './mutation-guards'
import { CMS_SITE, cmsSiteContext, migrationRequest } from './cms-scope'
import { authorityClaim } from './claims'
import { claimRequest } from './identity-authority'

const scoped = new Set([...scopedCMS, ...guardedMutations.map(([slug]) => slug)])
/** A virtual field travels with native form state. It selects the editor's original
 * site on save, independently of another tab's changed preference. It grants no rights. */
export async function bindEditorSite(req: PayloadRequest, value: unknown): Promise<void> {
  if (migrationRequest(req) || !req.user || value === undefined) return
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new APIError('Choose a valid editor site.', 400)
  const explicit =
    (req.context as Record<symbol, unknown>)[CMS_SITE] ?? req.headers?.get('x-vorticause-site')
  if (explicit && explicit !== value)
    throw new APIError('The editor site changed. Reload and review before saving.', 409)
  Object.assign(req.context, cmsSiteContext(value))
  await claimRequest(req, value)
}
export const tenantEditorSite = (config: Config): Config => ({
  ...config,
  collections: (config.collections || []).map((collection) => {
    if (!scoped.has(collection.slug)) return collection
    return {
      ...collection,
      fields: [
        ...collection.fields,
        {
          name: 'editorSite',
          type: 'text' as const,
          virtual: true,
          admin: { hidden: true },
          defaultValue: async ({ req }: { req: PayloadRequest }) =>
            (await claimRequest(req))?.site || 'default',
        },
      ],
      hooks: {
        ...collection.hooks,
        beforeOperation: [
          async ({ req, args, operation }) => {
            if ('data' in args && args.data) {
              const data = args.data as Record<string, unknown>
              await bindEditorSite(req, data.editorSite)
              // Native create forms carry the compatibility SQL default. Their virtual
              // editor context is the explicit target; all authority checks still run below.
              if (operation === 'create' && typeof data.editorSite === 'string') {
                if (scopedCMS.has(collection.slug) && data.platformSite === 'default')
                  data.platformSite = data.editorSite
                if (collection.slug.startsWith('form') && data.site === 'default')
                  data.site = data.editorSite
              }
            }
            return args
          },
          ...(collection.hooks?.beforeOperation || []),
        ],
        afterRead: [
          ...(collection.hooks?.afterRead || []),
          ({ req, doc }) => ({
            ...doc,
            editorSite:
              doc.platformSite ||
              doc.site ||
              doc.documentSite ||
              authorityClaim(req.user)?.site ||
              'default',
          }),
        ],
      },
    }
  }),
})
