import { APIError, type CollectionConfig, type CollectionSlug } from 'payload'
import { audienceTablesV1 } from './audience-schema-v1'
import { readersSlug, readersView } from './readers-schema-v1'

/** Internal read-only view mappings. They have no writable data or public API. */
export const publishingReaderCollections: CollectionConfig[] = [...audienceTablesV1, ['review-tasks', 'review_document', null] as const].map(([slug, table, versions]) => ({
  slug: readersSlug(slug), dbName: readersView(table), admin: { hidden: true }, timestamps: false,
  graphQL: { disableMutations: true, disableQueries: true },
  access: { create: () => false, read: () => false, update: () => false, delete: () => false },
  hooks: { beforeOperation: [() => { throw new APIError('This authorization view has no document API.', 403) }] },
  fields: [
    { name: 'id', type: 'text', required: true },
    { name: 'record', type: 'relationship', relationTo: slug as CollectionSlug, required: true },
    { name: 'actor', type: 'number' }, { name: 'site', type: 'text' }, { name: 'audience', type: 'text' },
    { name: 'validStructure', type: 'checkbox' }, { name: 'publishedTree', type: 'checkbox' }, { name: 'ordinaryAccess', type: 'checkbox' },
    ...(['search', 'review-tasks'].includes(slug) ? [{ name: 'sourceCollection', type: 'text' as const }] : []),
    ...(versions ? [{ name: 'draftFree', type: 'checkbox' as const }] : []),
  ],
}))
