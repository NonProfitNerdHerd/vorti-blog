import { APIError, type CollectionSlug, type Field, type PayloadRequest } from 'payload'
import { scopedCMS } from './cms-collections'

/** Validate only native relationships here. JSON-backed builder references still resolve through
 * the scoped CMS API, so a guessed foreign ID cannot bypass the owning-site predicate. */
export async function validateCMSRelations(
  req: PayloadRequest,
  fields: Field[],
  data: Record<string, unknown>,
  originalData: Record<string, unknown> = {},
): Promise<void> {
  const references = new Map<string, Set<string>>()
  let count = 0
  const add = (collection: string, value: unknown): void => {
    if ((!scopedCMS.has(collection) && collection !== 'users') || value == null) return
    const id = typeof value === 'object' && 'id' in value ? String(value.id) : String(value)
    if (!/^[1-9][0-9]*$/.test(id)) throw new APIError('Choose a valid related record.', 400)
    count++
    if (count > 500) throw new APIError('Too many related records in one save.', 400)
    const ids = references.get(collection) || new Set<string>()
    ids.add(id)
    references.set(collection, ids)
  }
  const normalized = (value: unknown): string =>
    String(value && typeof value === 'object' && 'id' in value ? value.id : value)
  const walk = (
    definitions: Field[],
    values: Record<string, unknown>,
    before: Record<string, unknown> = {},
  ): void => {
    for (const field of definitions) {
      if ('tabs' in field) {
        for (const tab of field.tabs) {
          const child = 'name' in tab && tab.name ? values[tab.name] : values
          const old = 'name' in tab && tab.name ? before[tab.name] : before
          if (child && typeof child === 'object' && !Array.isArray(child))
            walk(
              tab.fields,
              child as Record<string, unknown>,
              (old as Record<string, unknown>) || {},
            )
        }
      } else if ('name' in field && field.name && Object.hasOwn(values, field.name)) {
        const value = values[field.name]
        const oldValue = before[field.name]
        if ((field.type === 'relationship' || field.type === 'upload') && value != null) {
          for (const item of Array.isArray(value) ? value : [value]) {
            if (typeof field.relationTo === 'string') {
              // Account deactivation must not prevent unrelated edits of historical bylines.
              const unchanged =
                field.relationTo === 'users' &&
                (Array.isArray(oldValue) ? oldValue : [oldValue]).some(
                  (old) => normalized(old) === normalized(item),
                )
              if (!unchanged) add(field.relationTo, item)
            } else if (item && typeof item === 'object' && 'relationTo' in item && 'value' in item)
              add(String(item.relationTo), item.value)
          }
        } else if (field.type === 'blocks' && Array.isArray(value)) {
          for (const row of value) {
            if (!row || typeof row !== 'object') continue
            const block = field.blocks.find(
              (block) => typeof block !== 'string' && block.slug === row.blockType,
            )
            if (block && typeof block !== 'string') walk(block.fields, row)
          }
        } else if ('fields' in field) {
          for (const row of Array.isArray(value) ? value : [value])
            if (row && typeof row === 'object') walk(field.fields, row)
        }
      } else if ('fields' in field && !('name' in field)) walk(field.fields, values)
    }
  }
  walk(fields, data, originalData)
  for (const [collection, identifiers] of references) {
    const ids = [...identifiers]
    for (let start = 0; start < ids.length; start += 75) {
      const chunk = ids.slice(start, start + 75)
      const result = await req.payload.find({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        depth: 0,
        pagination: false,
        limit: chunk.length,
        select: collection === 'users' ? { username: true } : ({ platformSite: true } as never),
        where: { id: { in: chunk } },
      })
      if (result.docs.length !== chunk.length)
        throw new APIError('A related record is unavailable in this site.', 403)
    }
  }
}
