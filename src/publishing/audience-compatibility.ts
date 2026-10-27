import { APIError, type AccessResult, type CollectionConfig, type Config, type Where } from 'payload'
import { audienceTablesV1 } from './audience-schema-v1'

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
      for (const operation of ['read', 'readVersions', 'update', 'delete'] as const) {
        if (operation === 'readVersions' && !collection.versions) continue
        const original = access[operation]
        access[operation] = async (args) => publicOnly(
          original ? await original(args) : Boolean(args.req.user), operation === 'readVersions',
        )
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
