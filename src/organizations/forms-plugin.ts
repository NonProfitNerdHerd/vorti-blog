import { APIError, type Config, type PayloadRequest, type Field } from 'payload'
import { canForm, internalRequest, type FormPermission } from '../forms/access'
import { authorityClaim } from './claims'
import { claimRequest } from './identity-authority'
import { migrationRequest } from './cms-scope'
import type { Permission } from './permission-catalog'
import { TenantRepository } from './tenant-repository'
import { cmsDatabase } from './cms-scope'

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
    const readPermission: Permission = [
      'forms',
      'form-revisions',
      'form-drafts',
      'form-resources',
      'form-templates',
    ].includes(collection.slug)
      ? 'forms:read'
      : permission === 'integrations'
        ? 'forms:configure-integrations'
        : permission === 'export'
          ? 'forms:export'
          : 'forms:read-submissions'
    return {
      ...collection,
      fields: collection.slug === 'forms' ? scopedSlug(collection.fields) : collection.fields,
      indexes: [
        ...(collection.indexes || []),
        ...(collection.slug === 'forms' ? [{ fields: ['site', 'slug'], unique: true }] : []),
      ],
      access: {
        ...collection.access,
        read: async (args) => {
          const claim = authorityClaim(args.req.user)
          if (claim?.permissions && staffRequest(args.req))
            return claim.permissions.includes(readPermission)
              ? { site: { equals: claim.site } }
              : false
          return collection.access?.read ? collection.access.read(args) : false
        },
        ...(collection.slug === 'form-submissions'
          ? {
              update: async (args: Parameters<NonNullable<typeof collection.access.update>>[0]) => {
                const claim = authorityClaim(args.req.user)
                if (claim?.permissions && staffRequest(args.req))
                  return claim.permissions.includes('forms:update-submissions')
                    ? { site: { equals: claim.site } }
                    : false
                return collection.access?.update ? collection.access.update(args) : false
              },
              delete: async (args: Parameters<NonNullable<typeof collection.access.delete>>[0]) => {
                const claim = authorityClaim(args.req.user)
                if (claim?.permissions && staffRequest(args.req))
                  return claim.permissions.includes('forms:delete-submissions')
                    ? { site: { equals: claim.site } }
                    : false
                return collection.access?.delete ? collection.access.delete(args) : false
              },
            }
          : {}),
        ...(collection.versions
          ? {
              readVersions: ({ req }) => {
                const claim = authorityClaim(req.user),
                  site = claim?.site
                if (claim?.permissions)
                  return claim.permissions.includes(readPermission)
                    ? { 'version.site': { equals: site } }
                    : false
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
            if (claim?.permissions) {
              const reading = [
                'read',
                'count',
                'readDistinct',
                'readVersions',
                'readVersionByID',
              ].includes(operation)
              const exact: Permission = reading
                ? readPermission
                : collection.slug === 'forms'
                  ? `forms:${operation === 'create' ? 'create' : operation === 'delete' ? 'delete' : 'edit'}`
                  : collection.slug === 'form-submissions'
                    ? operation === 'delete'
                      ? 'forms:delete-submissions'
                      : 'forms:update-submissions'
                    : permission === 'integrations' || permission === 'admin'
                      ? 'forms:configure-integrations'
                      : 'forms:edit'
              if (!claim.permissions.includes(exact))
                throw new APIError('Form operation unavailable.', 403)
              if (reading && claim.tenantAdministrator)
                await new TenantRepository(cmsDatabase(req), claim.actor).read(
                  {
                    site: claim.site,
                    permission: readPermission,
                    resource: `${collection.slug}:${operation}`,
                  },
                  async (): Promise<void> => {},
                )
            }
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
              (!(authorityClaim(req.user)?.permissions
                ? authorityClaim(req.user)!.permissions!.includes(readPermission)
                : canForm(req.user, permission, doc.site)) ||
                doc.site !== authorityClaim(req.user)?.site)
            )
              throw new APIError('Form record unavailable in this site.', 403)
            return doc
          },
          ...(collection.hooks?.beforeRead || []),
        ],
        beforeChange: [
          async ({ req, data, originalDoc, operation }) => {
            if (!internalRequest(req) && !migrationRequest(req)) {
              const claim = await claimRequest(req)
              if (
                !claim ||
                (originalDoc?.site && originalDoc.site !== claim.site) ||
                (data.site && data.site !== claim.site)
              )
                throw new APIError('Form records cannot move between sites.', 403)
              data.site = claim.site
              const allowed = claim.permissions
                ? claim.permissions.includes(
                    collection.slug === 'forms'
                      ? operation === 'create'
                        ? 'forms:create'
                        : 'forms:edit'
                      : collection.slug === 'form-submissions'
                        ? 'forms:update-submissions'
                        : permission === 'integrations' || permission === 'admin'
                          ? 'forms:configure-integrations'
                          : 'forms:edit',
                  )
                : canForm(req.user, permission, claim.site)
              if (!allowed) throw new APIError('Form editing unavailable in this site.', 403)
            }
            return data
          },
          ...(collection.hooks?.beforeChange || []),
        ],
      },
    }
  }),
})
