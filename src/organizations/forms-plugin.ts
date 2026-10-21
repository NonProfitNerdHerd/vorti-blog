import { APIError, type Config, type PayloadRequest, type Field } from 'payload'
import { canForm, internalRequest, type FormPermission } from '../forms/access'
import { authorityClaim } from './claims'
import { claimRequest } from './identity-authority'
import { migrationRequest } from './cms-scope'

const permissions: Record<string, FormPermission> = {
  forms: 'edit',
  'form-submissions': 'entries',
  'form-revisions': 'edit',
  'form-drafts': 'admin',
  'form-attachments': 'entries',
  'form-outbox': 'integrations',
  'form-audit': 'entries',
  'form-analytics': 'entries',
  'form-deliveries': 'integrations',
  'form-resources': 'edit',
  'form-templates': 'edit',
  'form-integrations': 'integrations',
  'form-exports': 'export',
  'form-contacts': 'entries',
  'form-support-requests': 'entries',
}
const staffRequest = (req: PayloadRequest) =>
  !!req.user && !internalRequest(req) && !migrationRequest(req)
function scopedSlug(fields: Field[]): Field[] {
  return fields.map((field) =>
    'name' in field && field.name === 'slug' && 'unique' in field
      ? { ...field, unique: false }
      : 'fields' in field
        ? { ...field, fields: scopedSlug(field.fields) }
        : field,
  )
}
/** Public runtime uses explicitly scoped server queries; native staff APIs cannot bypass ownership. */
export const tenantForms = (config: Config): Config => ({
  ...config,
  collections: (config.collections || []).map((collection) => {
    const permission = permissions[collection.slug]
    if (!permission) return collection
    return {
      ...collection,
      fields: collection.slug === 'forms' ? scopedSlug(collection.fields) : collection.fields,
      indexes: [
        ...(collection.indexes || []),
        ...(collection.slug === 'forms' ? [{ fields: ['site', 'slug'], unique: true }] : []),
      ],
      access: {
        ...collection.access,
        ...(collection.versions
          ? {
              readVersions: ({ req }) => {
                const site = authorityClaim(req.user)?.site
                return site && canForm(req.user, permission, site)
                  ? { 'version.site': { equals: site } }
                  : false
              },
            }
          : {}),
      },
      forceSelect: { ...collection.forceSelect, site: true },
      hooks: {
        ...collection.hooks,
        beforeOperation: [
          async ({ req, args, operation }) => {
            if (!staffRequest(req)) return args
            const claim = await claimRequest(req)
            ;(args as unknown as { overrideAccess: boolean }).overrideAccess = false
            if (operation === 'restoreVersion' && collection.slug === 'forms' && 'id' in args) {
              const { cmsDatabase } = await import('./cms-scope')
              if (
                !canForm(req.user, 'edit', claim?.site) ||
                !(await cmsDatabase(req)
                  .prepare('SELECT id FROM _forms_v WHERE id=? AND version_site=?')
                  .bind(args.id, claim?.site)
                  .first())
              )
                throw new APIError('Form version unavailable.', 404)
            }
            if (operation === 'create' && 'data' in args && args.data) {
              if (args.data.site && args.data.site !== claim?.site)
                throw new APIError('Choose the active site for this form record.', 403)
              args.data.site = claim?.site
            }
            return args
          },
          ...(collection.hooks?.beforeOperation || []),
        ],
        beforeRead: [
          async ({ req, doc }) => {
            if (
              staffRequest(req) &&
              (!canForm(req.user, permission, doc.site) ||
                doc.site !== authorityClaim(req.user)?.site)
            )
              throw new APIError('Form record unavailable in this site.', 403)
            return doc
          },
          ...(collection.hooks?.beforeRead || []),
        ],
        beforeChange: [
          async ({ req, data, originalDoc }) => {
            if (!internalRequest(req) && !migrationRequest(req)) {
              const claim = await claimRequest(req)
              if (
                !claim ||
                (originalDoc?.site && originalDoc.site !== claim.site) ||
                (data.site && data.site !== claim.site)
              )
                throw new APIError('Form records cannot move between sites.', 403)
              data.site = claim.site
              if (!canForm(req.user, permission, claim.site))
                throw new APIError('Form editing unavailable in this site.', 403)
            }
            return data
          },
          ...(collection.hooks?.beforeChange || []),
        ],
      },
    }
  }),
})
