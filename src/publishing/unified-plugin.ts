import { APIError, type AccessResult, type CollectionConfig, type CollectionSlug, type Config, type Field, type PayloadRequest, type Where } from 'payload'
import { readersSlug } from './readers-schema-v1'
import { audienceTablesV1 } from './audience-schema-v1'
import { CMS_AUDIENCE, CMS_EXPORT_WRITE, CMS_PUBLIC_RENDER, CMS_AUDIENCE_OPERATION, type Audience } from './readership'
import { cmsDatabase, cmsScope } from '../organizations/cms-scope'
import { TenantRepository } from '../organizations/tenant-repository'
import { authorizeInternalRecord } from './record-access'
import { nativeReaderPredicate } from './reader-policy'
import type { Permission } from '../organizations/permission-catalog'
import { INTERNAL_MEDIA_PREFIX } from './storage'
import { scopedSettingsForAuthorizedSite } from '../organizations/scoped-settings'
import { validatePublishingDependencies } from './dependencies'
import { claimRequest } from '../organizations/identity-authority'
import { assertPublishingPipeline, pinPublishingPipeline, publicPipelineReadership } from './pipeline-scope'
import { saveExportManifest } from './export-manifest'
import { publishingPipelineJobs } from './pipeline-jobs'

type Context = Record<string | symbol, unknown>
const historyScope = Symbol.for('vorticause.server-publishing-history')
const mediaUploadPrefix = Symbol.for('vorticause.server-media-upload-prefix')
const routePrefixes = Symbol.for('vorticause.server-publishing-route-prefixes')
const mediaSource = Symbol.for('vorticause.server-media-upload-source')
const storedMediaSource = Symbol.for('vorticause.server-media-stored-source')
const draftWrite = Symbol.for('vorticause.server-publishing-draft-write')
const templateRoles = Symbol.for('vorticause.server-publishing-template-roles')
const reviewAudit = Symbol.for('vorticause.server-publishing-review-audit')
const storedIdentities = Symbol.for('vorticause.server-publishing-identities')
const audience = (req: PayloadRequest): Audience => (req.context as Context)[CMS_AUDIENCE] === 'intranet' ? 'intranet' : 'public'
const combine = (result: AccessResult, predicate: Where): AccessResult => result === false ? false : result === true ? predicate : { and: [result, predicate] }
const people = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length > 500 || value.some(id => !Number.isSafeInteger(id) || id < 1)) throw new APIError('Select valid people.', 400)
  return [...new Set(value)]
}
const groups = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) throw new APIError('Select valid sharing groups.', 400)
  return [...new Set(value)]
}
const fields: Field[] = [
  { name: 'audience', type: 'select', defaultValue: 'public', index: true, options: [{ label: 'Public', value: 'public' }, { label: 'Intranet', value: 'intranet' }], admin: { position: 'sidebar', components: { Field: './publishing/AudienceField#AudienceField' } } },
  { name: 'publishingReadership', label: 'Readership', type: 'select', defaultValue: 'site', options: [{ label: 'Permitted site members', value: 'site' }, { label: 'Selected people and sharing groups', value: 'restricted' }], admin: { hidden: true } },
  { name: 'publishingPeople', label: 'Shared with people', type: 'json', defaultValue: [], admin: { hidden: true } },
  { name: 'publishingGroups', label: 'Shared with groups', type: 'json', defaultValue: [], admin: { hidden: true } },
  { name: 'publishingSharing', type: 'ui', admin: { position: 'sidebar', components: { Field: './publishing/SharingPanel#SharingPanel' } } },
  { name: 'publishingOwner', type: 'number', admin: { hidden: true }, access: { create: () => false, update: () => false } },
  { name: 'publishingOperationKey', type: 'text', unique: true, admin: { hidden: true }, access: { create: () => false, update: () => false } },
  { name: 'publishingLineage', type: 'text', admin: { readOnly: true } },
  { name: 'publishingSitePrefix', type: 'text', virtual: true, admin: { hidden: true } },
  { name: 'publishingPublishedAt', type: 'date', admin: { hidden: true }, access: { read: () => false, create: () => false, update: () => false } },
  { name: 'publishingIdentity', type: 'text', unique: true, admin: { hidden: true }, access: { create: () => false, update: () => false } },
]

export const unifiedPublishing = (config: Config): Config => ({
  ...config,
  jobs: publishingPipelineJobs(config),
  admin: { ...config.admin, components: { ...config.admin?.components, views: { ...config.admin?.components?.views,
    intranetGroups: { path: '/intranet/groups', Component: './publishing/GroupsPage#GroupsPage' } } } },
  collections: (config.collections || []).map((collection): CollectionConfig => {
    if (collection.slug === 'review-tasks') return { ...collection, fields: [...collection.fields,
      { name: 'publishingDocumentReadability', type: 'join', collection: readersSlug('review-tasks') as CollectionSlug, on: 'record', admin: { hidden: true }, access: { read: () => false } }],
      hooks: { ...collection.hooks, beforeOperation: [async ({ args, req, operation }) => {
        if (req.user && ['read', 'count'].includes(operation)) {
          const claim = await claimRequest(req), context = req.context as Context
          const audited = (context[reviewAudit] ||= new Set()) as Set<string>
          if (claim?.tenantAdministrator && claim.permissions?.includes('intranet:read-history') && claim.featureSites?.intranet?.includes(claim.site) && !audited.has(claim.site)) {
            await new TenantRepository(cmsDatabase(req), Number(req.user.id)).read({ site: claim.site, permission: 'intranet:read-history', privateRecord: true, recordAccess: true, resource: 'document-review-tasks:query' }, async (): Promise<void> => {})
            audited.add(claim.site)
          }
        }
        return args
      }, ...(collection.hooks?.beforeOperation || [])] } }
    const mapping = audienceTablesV1.find(([slug]) => slug === collection.slug)
    if (!mapping) return collection
    const access = { ...collection.access }
    for (const operation of ['create', 'read', 'readVersions', 'update', 'delete'] as const) {
      if (operation === 'readVersions' && !collection.versions) continue
      const original = access[operation]
      access[operation] = async args => {
        const versions = operation === 'readVersions'
        if (audience(args.req) === 'intranet') {
          const scope = await cmsScope(args.req, 'read')
          if (!args.req.user) return false
          const action = collection.slug === 'exports' && ['create', 'update'].includes(operation) ? 'read-history' : operation === 'readVersions' ? 'read-history' : operation === 'update' ? 'edit' : operation
          try { await new TenantRepository(cmsDatabase(args.req), Number(args.req.user.id)).require(scope.site, `intranet:${action}` as Permission) }
          catch (error) { if ([403, 404].includes(Number((error as { status?: number }).status))) return false; throw error }
        }
        const result = original ? await original(args) : Boolean(args.req.user)
        const selected = audience(args.req)
        if (operation === 'create') return result === true
        let predicate: Where = versions ? {} : { audience: { equals: selected } }
        if (result === false) return false
        const scope = await cmsScope(args.req, 'read')
        predicate = { and: [predicate, await nativeReaderPredicate(args.req, collection.slug, scope.site,
          { internal: selected === 'intranet', versions, mutation: operation === 'update' || operation === 'delete' })] }
        if (selected === 'public' && (collection.slug === 'imports' || collection.slug === 'exports'))
          predicate = { and: [predicate, await publicPipelineReadership(args.req, scope.site, collection.slug)] }
        return combine(result, predicate)
      }
    }
    return {
      ...collection, access,
      endpoints: (collection.endpoints || []).map(endpoint => !['imports', 'exports'].includes(collection.slug) ? endpoint : { ...endpoint, handler: async req => {
        const selected = new URL(req.url!).searchParams.get('audience') || req.headers.get('x-vorticause-audience') || 'public'
        if (selected !== 'public' && selected !== 'intranet') throw new APIError('Choose a valid publishing area.', 400)
        ;(req.context as Context)[CMS_AUDIENCE] = selected
        const scope = await cmsScope(req, 'read')
        pinPublishingPipeline(req, scope.site, selected)
        const result = await endpoint.handler(req)
        assertPublishingPipeline(req)
        return result
      } }),
      admin: { ...collection.admin, components: { ...collection.admin?.components,
        beforeList: [...(collection.admin?.components?.beforeList || []), './publishing/AreaBanner#AreaBanner'] },
        ...(collection.slug === 'site-templates' ? { defaultColumns: ['name', 'publishingTemplateRole', 'slug', '_status', 'updatedAt'] } : {}) },
      fields: [...collection.fields, ...fields, ...(['posts', 'pages'].includes(collection.slug) ? [{ name: 'publishingTransfer', type: 'ui' as const, admin: { position: 'sidebar' as const, components: { Field: './publishing/TransferPanel#TransferPanel' } } },
        { name: 'publishingPrivateHistory', type: 'ui' as const, admin: { position: 'sidebar' as const, components: { Field: './publishing/LegacyHistoryPanel#PrivateHistoryPanel' } } }] : []), ...(collection.slug === 'site-templates' ? [{ name: 'publishingTemplateRole', label: 'Site purpose', type: 'text' as const, virtual: true, admin: { readOnly: true, position: 'sidebar' as const }, access: { create: () => false, update: () => false } }] : []), ...(collection.slug === 'pages' ? [{ name: 'publishingArchived', type: 'checkbox' as const, defaultValue: false, admin: { hidden: true }, access: { create: () => false, update: () => false } },
        { name: 'publishingLegacyHistory', type: 'ui' as const, admin: { position: 'sidebar' as const, components: { Field: './publishing/LegacyHistoryPanel#LegacyHistoryPanel' } } }] : []), { name: 'publishingReadability', type: 'join', collection: readersSlug(collection.slug) as CollectionSlug, on: 'record', admin: { hidden: true }, access: { read: () => false } }, ...(['media', 'imports', 'exports'].includes(collection.slug) ? [{ name: 'prefix', type: 'text' as const,
        admin: { hidden: true }, access: { create: () => false, update: () => false } }] : []), ...(collection.slug === 'media' ? [{ name: 'publishingSourceCollection', type: 'text' as const, admin: { hidden: true }, access: { create: () => false, update: () => false } },
        { name: 'publishingSourceID', type: 'number' as const, admin: { hidden: true }, access: { create: () => false, update: () => false } },
        { name: 'publishingSourceIdentity', type: 'text' as const, admin: { hidden: true }, access: { read: () => false, create: () => false, update: () => false } },
        { name: 'publishingRequiresPublication', type: 'checkbox' as const, defaultValue: false, admin: { hidden: true }, access: { read: () => false, create: () => false, update: () => false } },
        { name: 'publishingOriginalFilename', type: 'text' as const, admin: { readOnly: true }, access: { create: () => false, update: () => false } }] : [])],
      forceSelect: { ...collection.forceSelect, audience: true, publishingOwner: true, publishingReadership: true, publishingIdentity: true,
        ...(['media', 'imports', 'exports'].includes(collection.slug) ? { prefix: true, filename: true } : {}) },
      indexes: (collection.indexes || []).map(index => index.unique && index.fields.join(',') === 'platformSite,slug' ? { ...index, fields: ['platformSite', 'audience', 'slug'] } : index),
      hooks: {
        ...collection.hooks,
        beforeOperation: [async ({ args, req, operation }) => {
          const context = req.context as Context
          if (operation === 'create' || operation === 'update') context[draftWrite] = 'draft' in args && args.draft === true
          let selected: unknown = context[CMS_AUDIENCE]
          if (!selected && req.url) selected = new URL(req.url, 'https://local.invalid').searchParams.get('audience')
          selected ||= req.headers?.get('x-vorticause-audience')
          if (operation === 'create' && 'data' in args && args.data?.audience) selected = args.data.audience
          if ('id' in args && args.id != null) {
            // The installed Payload maps both version reads and ordinary reads to
            // the same hook operation. Ordinary read args always carry `draft`;
            // version operations use their separate argument shape.
            const version = operation === 'restoreVersion' || (operation === 'read' && !Object.hasOwn(args, 'draft') && Boolean(mapping[2]))
            const table = version ? mapping[2] : mapping[1]
            if (!table) throw new APIError('History unavailable.', 404)
            const stored = await cmsDatabase(req).prepare(version
              ? `SELECT p.audience,p.id parent,p.publishing_identity identity,p.created_at createdAt,${collection.slug === 'pages' ? 'p.publishing_archived' : '0'} archived FROM "${table}" v JOIN "${mapping[1]}" p ON p.id=v.parent_id WHERE v.id=?`
              : `SELECT audience,id parent,publishing_identity identity,created_at createdAt,${collection.slug === 'pages' ? 'publishing_archived' : '0'} archived FROM "${table}" WHERE id=?`).bind(args.id).first<{ audience: Audience; parent: number; archived: number; identity: string; createdAt: string }>()
            if (stored) {
              if (stored.archived) throw new APIError('Content unavailable.', 404)
              selected = stored.audience
              const identities = (context[storedIdentities] ||= new Map()) as Map<string, { identity: string; createdAt: string }>
              identities.set(`${collection.slug}:${stored.parent}`, stored)
              if (version) context[historyScope] = { collection: collection.slug, parent: stored.parent }
            } else if (version) throw new APIError('History unavailable.', 404)
          }
          if (selected != null && selected !== 'public' && selected !== 'intranet') throw new APIError('Choose a valid publishing area.', 400)
          selected ||= 'public'
          if (context[CMS_PUBLIC_RENDER] && selected !== 'public') throw new APIError('Content unavailable.', 404)
          context[CMS_AUDIENCE] = selected
          if (selected === 'public' && mapping[2] && operation === 'read' && 'draft' in args && args.draft === true) {
            const scope = await cmsScope(req, 'read'), claim = req.user ? await claimRequest(req, scope.site) : null
            const permission = collection.slug === 'site-templates' ? 'administration:templates' : collection.slug === 'saved-views' ? 'administration:saved-views' : `${collection.slug}:read-history` as Permission
            if (!req.user || claim?.permissions && !claim.permissions.includes(permission)) throw new APIError('History permission is required to read drafts.', req.user ? 403 : 404)
          }
          if (['imports', 'exports'].includes(collection.slug)) {
            const scope = await cmsScope(req, 'read')
            pinPublishingPipeline(req, scope.site, selected as Audience)
          }
          if (selected === 'intranet') {
            if (!req.user) throw new APIError('Content unavailable.', 404)
            const scope = await cmsScope(req, 'read')
            const action = collection.slug === 'exports' && ['create', 'update'].includes(operation) ? 'read-history' : operation === 'create' ? 'create' : operation === 'delete' ? 'delete' :
              ['update', 'restoreVersion'].includes(operation) ? 'edit' :
                operation === 'countVersions' || (operation === 'read' && !Object.hasOwn(args, 'draft') && Boolean(mapping[2])) || ('draft' in args && args.draft === true) ? 'read-history' : 'read'
            await new TenantRepository(cmsDatabase(req), Number(req.user.id)).require(scope.site, `intranet:${action}` as Permission)
            if (collection.slug === 'exports' && ['create', 'update'].includes(operation)) context[CMS_EXPORT_WRITE] = true
            if (operation === 'restoreVersion' || (operation === 'read' && 'id' in args && !Object.hasOwn(args, 'draft') && Boolean(mapping[2]))) {
              const history = context[historyScope] as { collection: string; parent: number }
              await authorizeInternalRecord(req, collection.slug, scope.site, history.parent)
              await new TenantRepository(cmsDatabase(req), Number(req.user.id)).require(scope.site, 'intranet:read-history')
            }
          }
          return args
        }, ...(collection.hooks?.beforeOperation || [])],
        beforeRead: [async ({ req, doc }) => {
          let identityID: number | undefined
          if (doc.publishingIdentity) {
            const current = await cmsDatabase(req).prepare(`SELECT id FROM "${mapping[1]}" WHERE publishing_identity=?`).bind(doc.publishingIdentity).first<{ id: number }>()
            if (!current || doc.id != null && Number(doc.id) !== Number(current.id)) throw new APIError('Content unavailable.', 404)
            identityID = current.id
          }
          // Payload's direct-version operation captures overrideAccess before its
          // operation hooks. The inner version has no ID, so protect historical
          // internal bodies here as well as through the native version predicate.
          if ((doc.id != null || audience(req) === 'public') && doc.audience !== audience(req)) throw new APIError('Content unavailable.', 404)
          if (audience(req) === 'intranet') {
            const scope = await cmsScope(req, 'read')
            const id = doc.id ?? identityID ?? doc.parent
            if (id != null) await authorizeInternalRecord(req, collection.slug, scope.site, Number(typeof id === 'object' ? id.id : id))
            if (collection.slug === 'pages' && doc.id != null && doc.parent != null) {
              const parent = typeof doc.parent === 'object' ? doc.parent.id : doc.parent
              await authorizeInternalRecord(req, 'pages', scope.site, Number(parent))
            }
          }
          return doc
        }, ...(collection.hooks?.beforeRead || [])],
        beforeValidate: [async ({ data, req, operation, originalDoc }) => {
          if (data && operation === 'update' && ['media', 'imports', 'exports'].includes(collection.slug)) {
            const stored = await cmsDatabase(req).prepare(`SELECT prefix${collection.slug === 'media' ? ',publishing_source_collection,publishing_source_i_d,publishing_source_identity,publishing_requires_publication,publishing_original_filename' : ''} FROM "${mapping[1]}" WHERE id=?`).bind(originalDoc.id).first<{ prefix: string | null } & Record<string, unknown>>()
            if (!stored) throw new APIError('File unavailable.', 404)
            data.prefix = stored.prefix || undefined
            ;(req.context as Context)[mediaUploadPrefix] = stored.prefix
            if (collection.slug === 'media') (req.context as Context)[storedMediaSource] = stored
          }
          if (data && operation === 'create') {
            data.audience = audience(req)
            if (['media', 'imports', 'exports'].includes(collection.slug)) {
              if (audience(req) === 'intranet' || collection.slug !== 'media') {
                data.prefix = INTERNAL_MEDIA_PREFIX + crypto.randomUUID()
                ;(req.context as Context)[mediaUploadPrefix] = data.prefix
              }
              else if (typeof data.prefix === 'string' && data.prefix.startsWith(INTERNAL_MEDIA_PREFIX))
                throw new APIError('Storage location is server-managed.', 403)
              if (collection.slug !== 'media') {
                data.publishingReadership = audience(req) === 'intranet' ? 'restricted' : 'site'
                data.publishingPeople = []; data.publishingGroups = []
              }
              const parentHeader = req.headers?.get('x-vorticause-publishing-parent')
              if (parentHeader && audience(req) === 'intranet' && collection.slug === 'media') {
                let parent: { collection?: string; id?: number }
                try { parent = JSON.parse(parentHeader) } catch { throw new APIError('Choose a valid upload document.', 400) }
                if (!['posts', 'pages'].includes(parent.collection) || !Number.isSafeInteger(parent.id) || parent.id < 1)
                  throw new APIError('Save the document before uploading its files.', 400)
                const source = await req.payload.findByID({ collection: parent.collection as 'posts' | 'pages', id: parent.id, req, depth: 0, draft: true, overrideAccess: false })
                if (source.audience !== 'intranet') throw new APIError('Upload document is outside the internal area.', 400)
                await new TenantRepository(cmsDatabase(req), Number(req.user!.id)).require(String(source.platformSite), 'intranet:edit')
                const metadata = source as unknown as Record<string, unknown>
                const sourceIdentity = await cmsDatabase(req).prepare(`SELECT publishing_identity FROM "${parent.collection}" WHERE id=? AND platform_site=? AND audience='intranet'`).bind(parent.id, source.platformSite).first<{ publishing_identity: string }>()
                if (!sourceIdentity?.publishing_identity) throw new APIError('Save and reload the document before uploading.', 409)
                ;(req.context as Context)[mediaSource] = { collection: parent.collection, id: parent.id, identity: sourceIdentity.publishing_identity, owner: metadata.publishingOwner }
                data.publishingReadership = metadata.publishingReadership
                data.publishingPeople = metadata.publishingPeople || []
                data.publishingGroups = metadata.publishingGroups || []
              }
            }
          }
          return data
        }, ...(collection.hooks?.beforeValidate || [])],
        beforeChange: [async ({ data, originalDoc, req, operation }) => {
          const selected = audience(req), context = req.context as Context
          const stored = (context[storedIdentities] as Map<string, { identity: string; createdAt: string }> | undefined)?.get(`${collection.slug}:${originalDoc?.id}`)
          const identity = operation === 'create' ? { identity: crypto.randomUUID(), createdAt: new Date().toISOString() } : stored ||
            await cmsDatabase(req).prepare(`SELECT publishing_identity identity,created_at createdAt FROM "${mapping[1]}" WHERE id=?`).bind(originalDoc.id).first<{ identity: string; createdAt: string }>()
          if (!identity?.identity) throw new APIError('Document identity changed. Reload before saving.', 409)
          data.publishingIdentity = identity.identity; data.createdAt = identity.createdAt
          data.publishingPublishedAt = mapping[2] && !context[draftWrite] && (data._status ?? originalDoc?._status) === 'published'
            ? new Date().toISOString() : originalDoc?.publishingPublishedAt || null
          if (collection.slug === 'pages') data.publishingArchived = operation === 'create' ? false : originalDoc?.publishingArchived === true
          if (['media', 'imports', 'exports'].includes(collection.slug)) data.prefix = operation === 'create'
            ? selected === 'intranet' || collection.slug !== 'media' ? context[mediaUploadPrefix] || INTERNAL_MEDIA_PREFIX + crypto.randomUUID() : undefined
            : context[mediaUploadPrefix] || undefined
          const upload = collection.slug === 'media' ? context[mediaSource] as { collection: string; id: number; identity: string; owner: number } | undefined : undefined
          if (collection.slug === 'media') {
            const stored = context[storedMediaSource] as Record<string, unknown> | undefined
            data.publishingOriginalFilename = operation === 'create' ? null : stored?.publishing_original_filename || null
            data.publishingSourceCollection = operation === 'create' ? upload?.collection || null : stored?.publishing_source_collection || null
            data.publishingSourceID = operation === 'create' ? upload?.id || null : stored?.publishing_source_i_d || null
            data.publishingSourceIdentity = operation === 'create' ? upload?.identity || null : stored?.publishing_source_identity || null
            data.publishingRequiresPublication = operation === 'create' ? Boolean(upload) : Number(stored?.publishing_requires_publication) === 1
          }
          if (operation === 'update' && data.audience !== undefined && data.audience !== originalDoc.audience && !context[CMS_AUDIENCE_OPERATION])
            throw new APIError('Use the explicit Copy or Move operation to change publishing area.', 409)
          const scope = await cmsScope(req, 'read')
          if (selected === 'intranet') {
            const authority = new TenantRepository(cmsDatabase(req), Number(req.user!.id))
            if (!context[draftWrite] && (data._status === 'published' || originalDoc?._status === 'published')) await authority.require(scope.site, 'intranet:publish')
            if (collection.slug === 'pages' && Object.hasOwn(data, 'parent')) {
              const parentID = (value: unknown) => value && typeof value === 'object' && 'id' in value ? value.id : value || null
              const before = parentID(originalDoc?.parent), after = parentID(data.parent)
              if (String(before) !== String(after)) {
                await authority.require(scope.site, 'intranet:manage-hierarchy')
              }
            }
          }
          if (!context[CMS_AUDIENCE_OPERATION] && ['publishingOwner', 'publishingOperationKey', 'publishingLineage'].some(key => Object.hasOwn(data, key) && data[key] !== originalDoc?.[key] && !(operation === 'create' && (data[key] == null || data[key] === ''))))
            throw new APIError('Publishing ownership and lineage are server-managed.', 403)
          const readers = people(data.publishingPeople ?? originalDoc?.publishingPeople ?? [])
          const selectedGroups = groups(data.publishingGroups ?? originalDoc?.publishingGroups ?? [])
          if (selected === 'public' && ((data.publishingReadership ?? originalDoc?.publishingReadership ?? 'site') !== 'site' || readers.length || selectedGroups.length))
            throw new APIError('Restricted readership belongs to Intranet. Use Copy or Move to change the publishing area.', 400)
          if (operation === 'update' && !context[CMS_AUDIENCE_OPERATION] &&
              ((data.publishingReadership ?? originalDoc.publishingReadership) !== originalDoc.publishingReadership ||
               JSON.stringify([...readers].sort((a, b) => a - b)) !== JSON.stringify(people(originalDoc.publishingPeople || []).sort((a, b) => a - b)) ||
               JSON.stringify([...selectedGroups].sort()) !== JSON.stringify(groups(originalDoc.publishingGroups || []).sort())))
            throw new APIError('Use Manage readership to save sharing changes atomically.', 409)
          const db = cmsDatabase(req)
          for (const id of readers) if (!(await db.prepare(`SELECT 1 FROM vc_tenant_memberships m WHERE tenant_id=? AND user_id=? AND active=1 AND EXISTS(SELECT 1 FROM vc_tenant_user_sites permitted WHERE permitted.user_id=m.user_id AND permitted.site=?) AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=m.user_id AND a.disabled=1)`).bind(scope.organization, id, scope.site).first())) throw new APIError('Sharing recipient unavailable.', 400)
          for (const id of selectedGroups) if (!(await db.prepare('SELECT 1 FROM vc_publishing_groups WHERE id=? AND tenant_id=? AND site_id=? AND retired=0').bind(id, scope.organization, scope.site).first())) throw new APIError('Sharing group unavailable.', 400)
          return { ...data, audience: selected, publishingOwner: (originalDoc?.publishingOwner ?? upload?.owner ?? Number(req.user?.id)) || null,
            publishingPeople: readers, publishingGroups: selectedGroups, publishingReadership: data.publishingReadership ?? originalDoc?.publishingReadership ?? 'site' }
        }, ...(collection.hooks?.beforeChange || []), async ({ data, originalDoc, req }) => {
          if (!(['search', 'event-series', 'imports', 'exports'].includes(collection.slug)) &&
            (!collection.versions || (!(req.context as Context)[draftWrite] && (data._status ?? originalDoc?._status) === 'published'))) {
            const scope = await cmsScope(req, 'read')
            await validatePublishingDependencies(req, scope.site, { ...originalDoc, ...data }, collection.fields, audience(req), { collection: collection.slug, ...(originalDoc?.id ? { id: Number(originalDoc.id) } : {}) })
          }
          return data
        }],
        afterRead: [...(collection.hooks?.afterRead || []), async ({ doc, req }) => {
          const context = req.context as Context
          if (collection.slug === 'site-templates') {
            const scope = await cmsScope(req, 'read')
            const roles = (context[templateRoles] ||= new Map()) as Map<string, Promise<Record<string, unknown>>>
            if (!roles.has(scope.site)) roles.set(scope.site, scopedSettingsForAuthorizedSite(cmsDatabase(req), scope.site, scope.organization).then(value => value.site.settings))
            const settings = await roles.get(scope.site)!
            doc.publishingTemplateRole = doc.audience === 'intranet' && Number(settings.intranetSiteTemplate) === Number(doc.id) ? 'Intranet default'
              : doc.audience === 'public' && Number(settings.defaultSiteTemplate) === Number(doc.id) ? 'Main (public default)' : 'Additional template'
          }
          const prefixes = (context[routePrefixes] ||= new Map()) as Map<string, Promise<string>>
          if (doc.platformSite && doc.platformSite !== 'default') {
            if (!prefixes.has(doc.platformSite)) prefixes.set(doc.platformSite, cmsDatabase(req).prepare('SELECT route_key FROM vc_sites WHERE id=?').bind(doc.platformSite).first<{ route_key: string }>().then(row => row ? `/sites/${row.route_key}` : ''))
            doc.publishingSitePrefix = await prefixes.get(doc.platformSite)
          } else doc.publishingSitePrefix = ''
          if ((collection.slug === 'media' && doc.audience === 'intranet') || collection.slug === 'imports' || collection.slug === 'exports') {
            doc.url = `/api/publishing/${collection.slug === 'media' ? 'media' : `files/${collection.slug}`}/${doc.id}?site=${encodeURIComponent(doc.platformSite)}`
            doc.thumbnailURL = doc.url
            if (doc.sizes) for (const [size, value] of Object.entries(doc.sizes)) {
              if (value && typeof value === 'object') (value as Record<string, unknown>).url = doc.url + `&size=${encodeURIComponent(size)}`
            }
          }
          return doc
        }],
        afterChange: [...(collection.hooks?.afterChange || []), async ({ doc, req, operation }) => {
          if (collection.slug === 'exports' && operation === 'create') {
            assertPublishingPipeline(req)
            await saveExportManifest(req, Number(doc.id))
          }
          return doc
        }],
        beforeDelete: [async ({ id, req }) => {
          if (collection.slug === 'pages' && await cmsDatabase(req).prepare("SELECT 1 FROM pages p WHERE p.id=? AND p.audience='intranet' AND EXISTS(SELECT 1 FROM pages child WHERE child.parent_id=p.id)").bind(id).first())
            throw new APIError('Review the internal hierarchy before deleting this Page.', 409)
        }, ...(collection.hooks?.beforeDelete || [])],
      },
    }
  }),
})
