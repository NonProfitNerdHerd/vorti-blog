import { APIError, type AccessResult, type CollectionConfig, type Config, type Where } from 'payload'
import { audienceTablesV1 } from './audience-schema-v1'
import { cmsDatabase, cmsScope } from '../organizations/cms-scope'

/** These collections contain audience-owned records; design definitions remain shared. */
export const audienceCollections = new Set(audienceTablesV1.map(([slug]) => slug))

const publicOnly = (result: AccessResult, versions: boolean): AccessResult => {
  if (result === false) return false
  const predicate: Where = { [versions ? 'version.audience' : 'audience']: { equals: 'public' } }
  return result === true ? predicate : { and: [result, predicate] }
}

/**
 * Recovery build: understand the expanded schema but never serve or mutate internal
 * records. This guard intentionally applies to administrators and Local API callers.
 * Deploy and verify this build before the unified publisher creates internal records.
 */
export function audienceCompatibility(config: Config): Config {
  return {
    ...config,
    collections: (config.collections || []).map((collection): CollectionConfig => {
      if (!audienceCollections.has(collection.slug)) return collection
      const access = { ...collection.access }
      const mapping = audienceTablesV1.find(([slug]) => slug === collection.slug)!
      for (const operation of ['read', 'readVersions', 'update', 'delete'] as const) {
        if (operation === 'readVersions' && !collection.versions) continue
        const original = access[operation]
        access[operation] = async (args) => {
          const result = publicOnly(original ? await original(args) : Boolean(args.req.user), operation === 'readVersions')
          if (operation !== 'readVersions' || result === false) return result
          const scope = await cmsScope(args.req, 'read')
          const rows = await cmsDatabase(args.req).prepare(`SELECT id FROM "${mapping[1]}" WHERE platform_site=? AND audience='public' LIMIT 10001`).bind(scope.site).all<{ id: number }>()
          if (rows.results.length > 10000) throw new APIError('History scope is too large.', 503)
          return { and: [result as Where, { parent: { in: rows.results.map(row => row.id) } }] }
        }
      }
      return {
        ...collection,
        access,
        fields: [...collection.fields, {
          name: 'audience', type: 'select', defaultValue: 'public', index: true,
          options: [{ label: 'Public', value: 'public' }, { label: 'Intranet', value: 'intranet' }],
          admin: { hidden: true },
        }],
        forceSelect: { ...collection.forceSelect, audience: true },
        hooks: {
          ...collection.hooks,
          beforeOperation: [
            async ({ req, args, operation }) => {
              // findVersionByID captures overrideAccess before hooks run in the
              // installed Payload version. Check both the version and its current
              // parent here, including public history of a later internal move.
              if (['findVersionByID', 'restoreVersion'].includes(operation) && 'id' in args) {
                if (!mapping[2]) throw new APIError('History unavailable.', 404)
                const scope = await cmsScope(req, 'read')
                const permitted = await cmsDatabase(req).prepare(`SELECT v.id FROM "${mapping[2]}" v JOIN "${mapping[1]}" p ON p.id=v.parent_id WHERE v.id=? AND v.version_audience='public' AND p.audience='public' AND p.platform_site=?`).bind(args.id, scope.site).first()
                if (!permitted) throw new APIError('History unavailable.', 404)
              }
              return args
            },
            ...(collection.hooks?.beforeOperation || []),
          ],
          beforeRead: [
            async ({ doc }) => {
              if (doc.audience !== 'public') throw new APIError('Content unavailable.', 404)
              return doc
            },
            ...(collection.hooks?.beforeRead || []),
          ],
          beforeChange: [
            async ({ data, originalDoc, operation }) => {
              if ((operation === 'update' && originalDoc?.audience !== 'public') ||
                  (data.audience !== undefined && data.audience !== 'public'))
                throw new APIError('Internal publishing requires the unified publisher.', 409)
              return { ...data, audience: 'public' }
            },
            ...(collection.hooks?.beforeChange || []),
          ],
        },
      }
    }),
  }
}
