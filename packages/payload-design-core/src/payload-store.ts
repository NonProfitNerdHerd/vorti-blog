import type { CollectionSlug, Payload, PayloadRequest } from 'payload'
import { slugs } from './types'
import type { DependencySource } from './dependencies'
import type { DesignStore, ResolveMode } from './resolver'
import type { ID } from './types'

type QueryClient = Pick<Payload, 'find' | 'findByID'>

export function createPayloadDesignStore(payload: QueryClient, req?: PayloadRequest): DesignStore {
  async function get(collection: string, id: ID, mode: ResolveMode) {
    try {
      return await payload.findByID({ collection: collection as CollectionSlug, id, depth: 0, draft: mode === 'draft', overrideAccess: false, req })
    } catch { return null }
  }
  return {
    getTemplate: (id, mode) => get(slugs.templates, id, mode) as unknown as ReturnType<DesignStore['getTemplate']>,
    getBlockDesign: (id, mode) => get(slugs.blockDesigns, id, mode) as unknown as ReturnType<DesignStore['getBlockDesign']>,
    getBlockType: (id, mode) => get(slugs.blockTypes, id, mode) as unknown as ReturnType<DesignStore['getBlockType']>,
  }
}

export function createPayloadDependencySource(payload: QueryClient, contentCollections: string[], req?: PayloadRequest): DependencySource {
  return {
    async templatesUsingDesign(id) {
      const result = await payload.find({ collection: slugs.templates as CollectionSlug, where: { 'sections.blockDesign': { equals: id } }, depth: 0, limit: 1000, pagination: false, overrideAccess: true, req })
      return result.docs.map((doc) => ({ id: doc.id, name: String((doc as unknown as { name: string }).name) }))
    },
    async contentUsingTemplate(id) {
      const results = await Promise.all(contentCollections.map(async (collection) => {
        const result = await payload.find({ collection: collection as CollectionSlug, where: { designTemplate: { equals: id } }, depth: 0, limit: 1000, pagination: false, overrideAccess: true, req })
        return result.docs.map((doc) => ({ collection, id: doc.id, status: (doc as { _status?: string })._status }))
      }))
      return results.flat()
    },
  }
}
