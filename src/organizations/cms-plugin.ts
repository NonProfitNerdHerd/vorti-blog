import { requireWebsitePublishing } from './websites'
import { publishingPipelineAllowed } from '../publishing/pipeline-scope'
import {
  APIError,
  addDataAndFileToRequest,
  type Access,
  type AccessResult,
  type CollectionConfig,
  type Config,
  type Field,
  type PayloadRequest,
  type Where,
} from 'payload'
import { cmsCollections, designCMS, scopedCMS } from './cms-collections'
import { validateCMSRelations } from './cms-relations'
import {
  CMS_DERIVED_READ,
  CMS_MENU_RENDER,
  cmsDatabase,
  cmsScope,
  confirmCMSScope,
  migrationRequest,
  type CMSScope,
} from './cms-scope'
import type { SiteOperation } from './policy'
import { claimRequest } from './identity-authority'
import type { Permission } from './permission-catalog'
import { featureAvailableAt } from './tenant-runtime'
import { TenantRepository } from './tenant-repository'
import { readBoundedJSON } from '../forms/security'
import { CMS_AUDIENCE } from '../publishing/readership'

const draftWrites = Symbol('native-cms-draft-writes')
const indexWrite = Symbol('validated-cms-index-write')
const protectedFields = ['platformSite', 'platformWriteActor', 'platformWriteEpoch']
const withWhere = (left: AccessResult, right: Where): AccessResult =>
  left === false ? false : left === true ? right : { and: [left, right] }
function transformFields(fields: Field[]): Field[] {
  return fields.map((field) => {
    if ('name' in field && field.name === 'slug' && 'unique' in field)
      return { ...field, unique: false }
    if ('tabs' in field)
      return {
        ...field,
        tabs: field.tabs.map((tab) => ({ ...tab, fields: transformFields(tab.fields) })),
      }
    if ('fields' in field) return { ...field, fields: transformFields(field.fields) }
    return field
  })
}
function hasSlug(fields: Field[]): boolean {
  return fields.some(
    (field) =>
      ('name' in field && field.name === 'slug') ||
      ('fields' in field && hasSlug(field.fields)) ||
      ('tabs' in field && field.tabs.some((tab) => hasSlug(tab.fields))),
  )
}
const ownershipFields: Field[] = [
  {
    name: 'platformSite',
    type: 'text',
    // Assigned and enforced by hooks/database guards, never required from Local API callers.
    required: false,
    defaultValue: 'default',
    index: true,
    admin: { hidden: true },
    access: { create: () => false, update: () => false },
  },
  {
    name: 'platformWriteActor',
    type: 'number',
    admin: { hidden: true },
    access: { read: () => false, create: () => false, update: () => false },
  },
  {
    name: 'platformWriteEpoch',
    type: 'number',
    admin: { hidden: true },
    access: { read: () => false, create: () => false, update: () => false },
  },
]
function cmsAccess(
  collection: CollectionConfig,
  action: 'create' | 'read' | 'readVersions' | 'update' | 'delete',
): Access {
  const original = collection.access?.[action]
  return async (args) => {
    const { req } = args
    if (migrationRequest(req))
      return action === 'create'
        ? true
        : {
            [action === 'readVersions' ? 'version.platformSite' : 'platformSite']: {
              equals: 'default',
            },
          }
    const permission: SiteOperation =
      collection.slug === 'exports' ? 'export' :
      action === 'read' || action === 'readVersions'
        ? 'read'
        : mutationPermission(collection.slug)
    let scope: CMSScope
    try {
      scope = await cmsScope(req, permission)
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        [403, 404].includes(Number(error.status))
      )
        return false
      throw error
    }
    const predicate = {
      [action === 'readVersions' ? 'version.platformSite' : 'platformSite']: { equals: scope.site },
    }
    if (
      (collection.slug === 'pages' || collection.slug === 'posts') &&
      !(await featureAvailableAt(cmsDatabase(req), scope.site,
        (req.context as Record<symbol, unknown>)[CMS_AUDIENCE] === 'intranet' ? 'intranet' : collection.slug))
    )
      return false
    if (
      ['search', 'event-series'].includes(collection.slug) &&
      (req.context as Record<symbol, unknown>)[indexWrite] === true
    )
      return action === 'create' ? true : predicate
    if (
      collection.slug === 'event-series' &&
      action === 'read' &&
      (req.context as Record<symbol, unknown>)[CMS_DERIVED_READ] === true
    )
      return predicate
    if (
      action === 'read' &&
      collection.slug === 'menus' &&
      (req.context as Record<symbol, unknown>)[CMS_MENU_RENDER] === true
    )
      return predicate
    let allowed: AccessResult = true
    let fineWhere: Where | undefined
    if (collection.slug === 'search' && action === 'read') {
      const claim = req.user ? await claimRequest(req, scope.site) : null
      const internal = (req.context as Record<symbol, unknown>)[CMS_AUDIENCE] === 'intranet'
      const resources: string[] = []
      for (const resource of ['posts', 'pages'] as const)
        if (
          (await featureAvailableAt(cmsDatabase(req), scope.site, internal ? 'intranet' : resource)) &&
          (!claim?.permissions || claim.permissions.includes(internal ? 'intranet:read' : `${resource}:read-published`))
        )
          resources.push(resource)
      if (!resources.length) return false
      fineWhere = { 'publishingReadability.sourceCollection': { in: resources } }
    }
    if (req.user && !scope.bootstrap) {
      const claim = await claimRequest(req, scope.site)
      if (claim?.permissions) {
        if (collection.slug === 'imports' || collection.slug === 'exports') {
          const actionName = collection.slug === 'imports' ? 'import' : 'export'
          const targets = ['pages', 'posts'].filter(target => publishingPipelineAllowed(req, claim.permissions!, actionName, target, action === 'create' && args.data?.drafts === 'yes'))
          if (!targets.length) return false
          if (action === 'create' && !targets.includes(String(args.data?.collectionSlug)))
            return false
          if (action !== 'create') fineWhere = { collectionSlug: { in: targets } }
        }
        if ((collection.slug === 'pages' || collection.slug === 'posts') &&
            (req.context as Record<symbol, unknown>)[CMS_AUDIENCE] !== 'intranet') {
          const actionName =
            action === 'read'
              ? 'read-published'
              : action === 'readVersions'
                ? 'read-history'
                : action === 'update'
                  ? 'edit'
                  : action
          const permission = `${collection.slug}:${actionName}` as Permission
          const history = claim.permissions.includes(`${collection.slug}:read-history`)
          if (!claim.permissions.includes(permission) && !(action === 'read' && history))
            return false
          if (action === 'read' && !history) fineWhere = { _status: { equals: 'published' } }
          if (
            args.data?._status === 'published' &&
            ['create', 'update'].includes(action) &&
            !claim.permissions.includes(`${collection.slug}:publish`)
          )
            return false
        } else if (!['read', 'readVersions'].includes(action)) {
          const controls: Record<string, Permission> = {
            media: 'administration:media',
            categories: 'administration:categories',
            tags: 'administration:tags',
            menus: 'administration:menus',
            'site-templates': 'administration:templates',
            'saved-views': 'administration:saved-views',
            redirects: 'administration:redirects',
            'design-block-types': 'administration:designs',
            'design-block-designs': 'administration:designs',
            'design-templates': 'administration:designs',
          }
          if (controls[collection.slug] && !claim.permissions.includes(controls[collection.slug]))
            return false
        }
      }
    }
    if (designCMS.has(collection.slug) && req.user && !scope.bootstrap) {
      let manager = false
      try {
        await cmsScope(req, 'configure')
        const claim = await claimRequest(req, scope.site)
        manager =
          !claim?.permissions ||
          claim.permissions.includes(
            collection.slug === 'site-templates'
              ? 'administration:templates'
              : 'administration:designs',
          )
      } catch {
        /* Published design selection remains available to readers. */
      }
      if (action === 'readVersions' && !manager) return false
      if (action === 'read' && !manager)
        allowed = {
          _status: { equals: 'published' },
          ...(['design-block-types', 'design-block-designs', 'design-templates'].includes(
            collection.slug,
          )
            ? { status: { equals: 'published' } }
            : {}),
        }
      else if (scope.site === 'default' && original) allowed = await original(args)
    } else allowed = original ? await original(args) : Boolean(req.user)
    if (fineWhere) allowed = withWhere(allowed, fineWhere)
    if (action === 'create') return allowed === true
    return withWhere(allowed, predicate)
  }
}
function mutationPermission(collection: string): SiteOperation {
  if (collection === 'exports') return 'export'
  return designCMS.has(collection) ? 'configure' : 'edit'
}
/** Access predicates apply to REST/GraphQL/counts/versions and also privileged Local API calls. */
export const tenantCMS = (config: Config): Config => ({
  ...config,
  collections: (config.collections || []).map((collection) => {
    if (!scopedCMS.has(collection.slug)) return collection
    const permission = mutationPermission(collection.slug),
      fields = transformFields(collection.fields)
    const authorizeWrite = async (
      data: Record<string, unknown>,
      originalDoc: Record<string, unknown> | undefined,
      req: PayloadRequest,
    ): Promise<CMSScope> => {
      const scope = await cmsScope(req, permission)
      if (originalDoc?.platformSite && originalDoc.platformSite !== scope.site)
        throw new APIError('Content unavailable in this site.', 403)
      const draft = (
        (req.context as Record<symbol, unknown>)[draftWrites] as Map<string, boolean> | undefined
      )?.get(collection.slug)
      const status = data._status ?? originalDoc?._status
      if (req.user && (collection.slug === 'pages' || collection.slug === 'posts') &&
          (req.context as Record<symbol, unknown>)[CMS_AUDIENCE] !== 'intranet') {
        const claim = await claimRequest(req, scope.site)
        if (
          claim?.permissions &&
          !draft &&
          (status === 'published' || originalDoc?._status === 'published') &&
          !claim.permissions.includes(`${collection.slug}:publish`)
        )
          throw new APIError('Publishing permission is required to change published content.', 403)
      }
      if (
        !draft &&
        (status === 'published' ||
          (originalDoc?._status === 'published' && data._status === 'draft'))
      )
        await cmsScope(req, 'publish')
      await confirmCMSScope(req, scope)
      return scope
    }
    return {
      ...collection,
      endpoints: (collection.endpoints || []).map((endpoint) =>
        !['imports', 'exports'].includes(collection.slug)
          ? endpoint
          : {
              ...endpoint,
              handler: async (req) => {
                const scope = await cmsScope(req, mutationPermission(collection.slug))
                const claim = req.user ? await claimRequest(req, scope.site) : null
                if (claim?.permissions) {
                  let data: Record<string, unknown>
                  if (collection.slug === 'imports') {
                    await addDataAndFileToRequest(req)
                    data = req.data || {}
                  } else {
                    const body = await readBoundedJSON(req.clone(), 128000)
                    data = (body.data || body) as Record<string, unknown>
                  }
                  const target = String(data.collectionSlug)
                  if (
                    !['pages', 'posts'].includes(target) ||
                    !publishingPipelineAllowed(req, claim.permissions, collection.slug === 'imports' ? 'import' : 'export', target, data.drafts === 'yes')
                  )
                    throw new APIError('This import or export is unavailable.', 403)
                }
                return endpoint.handler(req)
              },
            },
      ),
      fields: [...fields, ...ownershipFields],
      forceSelect: {
        ...collection.forceSelect,
        ...(process.env.PAYLOAD_MIGRATING === 'true' ? {} : { platformSite: true }),
      },
      indexes: [
        ...(collection.indexes || []),
        ...(hasSlug(fields) ? [{ fields: ['platformSite', 'slug'], unique: true }] : []),
      ],
      access: {
        ...collection.access,
        create: cmsAccess(collection, 'create'),
        read: cmsAccess(collection, 'read'),
        update: cmsAccess(collection, 'update'),
        delete: cmsAccess(collection, 'delete'),
        ...(collection.versions ? { readVersions: cmsAccess(collection, 'readVersions') } : {}),
      },
      hooks: {
        ...collection.hooks,
        afterRead: [
          ...(collection.hooks?.afterRead || []),
          async ({ req, doc }) => {
            if (collection.slug !== 'media' || migrationRequest(req)) return doc
            const scope = await cmsScope(req, 'read')
            if (scope.site === 'default' || !doc.filename) return doc
            const site = await cmsDatabase(req)
              .prepare('SELECT route_key FROM vc_sites WHERE id=?')
              .bind(scope.site)
              .first<{ route_key: string }>()
            if (!site) throw new APIError('Site unavailable.', 404)
            const path = `/sites/${site.route_key}/api/media/file/${encodeURIComponent(String(doc.filename))}`
            doc.url = path + (scope.actor ? '?preview=1' : '')
            return doc
          },
        ],
        beforeRead: [
          async ({ doc, req }) => {
            if (migrationRequest(req)) return doc
            const scope = await cmsScope(req, collection.slug === 'exports' ? 'export' : 'read')
            // Some installed version operations capture overrideAccess before hooks run. Their
            // inner version document still passes this hook before any field hooks or response.
            if (doc.platformSite !== scope.site)
              throw new APIError('Content unavailable in this site.', 403)
            if (collection.versions && doc.id == null) {
              if (!req.user) throw new APIError('Sign in to read document history.', 403)
              if (designCMS.has(collection.slug)) await cmsScope(req, 'configure')
            }
            return doc
          },
          ...(collection.hooks?.beforeRead || []),
        ],
        beforeOperation: [
          async ({ args, req, operation }) => {
            // findByID/restoreVersion do not honor an arbitrary args.where. Force the supported
            // access path rather than relying on a predicate those operations silently ignore.
            ;(args as unknown as { overrideAccess: boolean }).overrideAccess = false
            if (migrationRequest(req)) return args
            const scope = await cmsScope(
              req,
              collection.slug === 'exports' || ['create', 'update', 'delete', 'restoreVersion'].includes(operation)
                ? permission
                : 'read',
            )
            if (['imports', 'exports'].includes(collection.slug) && operation === 'create') {
              const claim = req.user ? await claimRequest(req, scope.site) : null
              if (claim?.permissions) {
                const target = String('data' in args && args.data?.collectionSlug)
                if (
                  !['pages', 'posts'].includes(target) ||
                  !publishingPipelineAllowed(req, claim.permissions, collection.slug === 'imports' ? 'import' : 'export', target, 'data' in args && args.data?.drafts === 'yes')
                )
                  throw new APIError('This import or export is unavailable.', 403)
              }
            }
            if (
              req.user &&
              ['pages', 'posts'].includes(collection.slug) &&
              !['create', 'update', 'delete', 'restoreVersion'].includes(operation)
            ) {
              const claim = await claimRequest(req, scope.site)
              if (claim?.tenantAdministrator)
                await new TenantRepository(cmsDatabase(req), Number(req.user.id)).read(
                  {
                    site: scope.site,
                    permission: ((req.context as Record<symbol, unknown>)[CMS_AUDIENCE] === 'intranet'
                      ? 'intranet:read' : `${collection.slug}:read-published`) as Permission,
                    resource: `${collection.slug}:${'id' in args ? String(args.id) : operation}`,
                  },
                  async (): Promise<void> => {},
                )
            }
            if (operation === 'restoreVersion' && 'id' in args) {
              const versions = cmsCollections.find(([slug]) => slug === collection.slug)?.[2]
              if (
                !versions ||
                !(await cmsDatabase(req)
                  .prepare(`SELECT id FROM "${versions}" WHERE id=? AND version_platform_site=?`)
                  .bind(args.id, scope.site)
                  .first())
              )
                throw new APIError('Version unavailable in this site.', 404)
            }
            if ('data' in args && args.data && typeof args.data === 'object') {
              const data = args.data as Record<string, unknown>
              if (Object.hasOwn(data, 'platformSite') && data.platformSite !== scope.site)
                throw new APIError('Content cannot change sites through an ordinary save.', 403)
              if (protectedFields.slice(1).some((key) => Object.hasOwn(data, key)))
                throw new APIError('Write authority is server-managed.', 403)
            }
            if (operation === 'create' || operation === 'update') {
              const modes = (req.context as Record<symbol, unknown>)[draftWrites] as
                Map<string, boolean> | undefined
              const next = modes || new Map<string, boolean>()
              next.set(collection.slug, 'draft' in args && args.draft === true)
              ;(req.context as Record<symbol, unknown>)[draftWrites] = next
            }
            return args
          },
          ...(collection.hooks?.beforeOperation || []),
        ],
        beforeValidate: [
          async ({ data, req }) => {
            if (!data) return data
            data.platformSite = migrationRequest(req)
              ? data.platformSite || 'default'
              : (await cmsScope(req, permission)).site
            return data
          },
          ...(collection.hooks?.beforeValidate || []),
        ],
        beforeChange: [
          async ({ data, originalDoc, req }) => {
            if (!migrationRequest(req)) await authorizeWrite(data, originalDoc, req)
            return data
          },
          ...(collection.hooks?.beforeChange || []),
          async ({ data, originalDoc, req }) => {
            if (migrationRequest(req))
              return {
                ...data,
                platformSite: originalDoc?.platformSite || data.platformSite || 'default',
              }
            const scope = await authorizeWrite(data, originalDoc, req)
            if (['posts', 'pages'].includes(collection.slug) && data._status === 'published' &&
                (req.context as Record<symbol, unknown>)[CMS_AUDIENCE] !== 'intranet')
              await requireWebsitePublishing(cmsDatabase(req), scope.site)
            await validateCMSRelations(req, fields, data, originalDoc)
            await confirmCMSScope(req, scope)
            return {
              ...data,
              platformSite: scope.site,
              platformWriteActor: scope.actor,
              platformWriteEpoch: scope.epoch,
            }
          },
        ],
        beforeDelete: [
          async ({ id, req }) => {
            if (migrationRequest(req)) return
            const scope = await cmsScope(req, permission)
            if (scope.bootstrap) return
            await confirmCMSScope(req, scope)
            await cmsDatabase(req)
              .prepare(
                'INSERT INTO vc_cms_delete_proofs(collection,record_id,site_id,actor_id,authority_revision,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(collection,record_id) DO UPDATE SET site_id=excluded.site_id,actor_id=excluded.actor_id,authority_revision=excluded.authority_revision,created_at=excluded.created_at',
              )
              .bind(
                collection.slug,
                String(id),
                scope.site,
                scope.actor,
                scope.epoch,
                new Date().toISOString(),
              )
              .run()
          },
          ...(collection.hooks?.beforeDelete || []).map((hook) =>
            ['posts', 'pages'].includes(collection.slug)
              ? async (args: Parameters<typeof hook>[0]) =>
                  hook({
                    ...args,
                    req: {
                      ...args.req,
                      headers: args.req.headers,
                      url: args.req.url,
                      context: {
                        ...args.req.context,
                        cmsHook: 'content-delete',
                        [indexWrite]: true,
                      },
                    } as PayloadRequest,
                  })
              : hook,
          ),
        ],
        afterOperation: [
          ...(collection.hooks?.afterOperation || []),
          async ({ req, result, operation }) => {
            if (!migrationRequest(req))
              await confirmCMSScope(
                req,
                await cmsScope(
                  req,
                  ['create', 'update', 'delete', 'restoreVersion'].includes(operation)
                    ? permission
                    : 'read',
                ),
              )
            return result
          },
        ],
        ...(['posts', 'pages'].includes(collection.slug)
          ? {
              afterChange: (collection.hooks?.afterChange || []).map(
                (hook) => async (args) =>
                  hook({
                    ...args,
                    req: {
                      ...args.req,
                      headers: args.req.headers,
                      url: args.req.url,
                      context: { ...args.req.context, cmsHook: 'content-sync', [indexWrite]: true },
                    } as PayloadRequest,
                  }),
              ),
            }
          : {}),
      },
    } satisfies CollectionConfig
  }),
})
