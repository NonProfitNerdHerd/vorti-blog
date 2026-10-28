import { APIError, createLocalReq, type CollectionSlug, type Field, type PayloadRequest } from 'payload'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'
import { audienceTablesV1 } from './audience-schema-v1'
import { CMS_AUDIENCE, CMS_PUBLIC_RENDER, type Audience } from './readership'

interface Reference { collection: string; id: number; path: string; identity?: string; navigation?: boolean }
const semanticReferences: Record<string, string> = {
  featuredImage: 'media', imageID: 'media', imageId: 'media', mediaID: 'media', mediaId: 'media', logo: 'media',
  image: 'media', backgroundImage: 'media', thumbnail: 'media', viewID: 'saved-views', savedViewID: 'saved-views',
  savedViewId: 'saved-views', menuID: 'menus', menuId: 'menus', postID: 'posts', postId: 'posts', pageID: 'pages', pageId: 'pages',
  formID: 'forms', formId: 'forms',
}
const internalAddress = /(?:^|[\s("'=])(?:https?:\/\/[^/\s]+)?\/(?:sites\/[^/\s]+\/)?(?:intranet(?:[/?#]|$)|api\/publishing(?:[/?#]|$))|__intranet__\//i
const recordID = (value: unknown): number | null => {
  if (value && typeof value === 'object' && 'id' in value) value = value.id
  return (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
}

/** Inventory only; no arbitrary collection/table names are executed. Inspect JSON
 * blocks as well as declared relationships so layout snapshots cannot conceal a
 * private dependency behind the shared editor's generic JSON fields.
 */
export function publicDependencyInventory(data: unknown, fields: Field[] = [], sourceCollection?: string) {
  const references: Reference[] = [], problems: string[] = []
  let visited = 0
  const add = (collection: string, value: unknown, path: string, navigation = false) => {
    if (Array.isArray(value)) { for (const item of value) add(collection, item, path, navigation); return }
    const id = recordID(value)
    const identity = value && typeof value === 'object' && 'publishingIdentity' in value && typeof value.publishingIdentity === 'string' ? value.publishingIdentity : undefined
    if (id) references.push({ collection, id, path, ...(identity ? { identity } : {}), ...(navigation ? { navigation: true } : {}) })
  }
  const schema = (value: unknown, definitions: Field[], path: string) => {
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    for (const field of definitions) {
      const next = 'name' in field ? row[field.name] : row, location = 'name' in field ? `${path}.${field.name}` : path
      if (field.type === 'relationship' || field.type === 'upload') {
        if (typeof field.relationTo === 'string') add(field.relationTo, next, location)
      }
      if ('fields' in field) {
        if (Array.isArray(next)) for (const item of next) schema(item, field.fields, location)
        else schema(next, field.fields, location)
      }
      if (field.type === 'tabs') for (const tab of field.tabs) schema('name' in tab ? row[tab.name] : row, tab.fields, location)
    }
  }
  const walk = (value: unknown, path: string, depth: number) => {
    if (++visited > 20000 || depth > 64) throw new APIError('This document exceeds the validated dependency review limit. Split or simplify it before public publication.', 400)
    if (typeof value === 'string') {
      if (internalAddress.test(value)) problems.push(`${path}: internal address`)
      return
    }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1)); return }
    const row = value as Record<string, unknown>
    if (row.kind === 'page') add('pages', row.target, path, sourceCollection === 'menus')
    if (row.kind === 'post') add('posts', row.target, path, sourceCollection === 'menus')
    if (typeof row.relationTo === 'string') add(row.relationTo, row.value, path)
    if (typeof row.collection === 'string' && row.id != null) add(row.collection, row.id, path)
    for (const [key, child] of Object.entries(row)) {
      if (key === 'publishingReadability') continue
      if (key === 'audience' && (child === 'intranet' || (child && typeof child === 'object' && JSON.stringify(child).includes('intranet')))) problems.push(`${path}.${key}: internal query`)
      if (semanticReferences[key]) add(semanticReferences[key], child, `${path}.${key}`)
      walk(child, `${path}.${key}`, depth + 1)
    }
  }
  schema(data, fields, 'document'); walk(data, 'document', 0)
  const byRecord = new Map<string, Reference>()
  for (const reference of references) {
    const key = `${reference.collection}:${reference.id}`, previous = byRecord.get(key)
    // A navigation link must never weaken an embedded/relationship dependency
    // to the same document, regardless of their order in the JSON tree.
    if (!previous || previous.navigation && !reference.navigation) byRecord.set(key, reference)
  }
  const distinct = [...byRecord.values()]
  if (distinct.length > 300) throw new APIError('Review fewer than 300 distinct dependencies per published document.', 400)
  return { references: distinct, problems }
}

export async function validatePublishingDependencies(req: PayloadRequest, site: string, data: unknown, fields: Field[], audience: Audience, self?: { collection: string; id?: number }) {
  // The document being published is validated by this operation. Generated
  // self-breadcrumbs (and intentional self-links) must not require its previous
  // draft to have already been published. Other references still need review.
  const queue = [publicDependencyInventory(data, fields, self?.collection)], seen = new Set<string>(self?.id ? [`${self.collection}:${self.id}`] : []), problems: string[] = []
  const local = await createLocalReq({ user: req.user, context: { ...cmsSiteContext(site), [CMS_AUDIENCE]: audience, ...(audience === 'public' ? { [CMS_PUBLIC_RENDER]: true } : {}) } }, req.payload)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const inventory = queue[cursor]
    if (audience === 'public') problems.push(...inventory.problems)
    for (const ref of inventory.references) {
      const record = `${ref.collection}:${ref.id}`, key = record + (ref.navigation ? ':navigation' : '')
      if (seen.has(record) || seen.has(key)) continue
      seen.add(key)
      if (seen.size > 300) throw new APIError('The dependency tree exceeds 300 records. Simplify it before publication.', 400)
      const mapping = audienceTablesV1.find(([slug]) => slug === ref.collection)
      if (mapping) {
        const row = await cmsDatabase(req).prepare(`SELECT audience,platform_site${mapping[2] ? ',_status' : ''} FROM "${mapping[1]}" WHERE id=?`).bind(ref.id).first<{ audience: string; platform_site: string; _status?: string }>()
        if (!row || row.audience !== audience || row.platform_site !== site || (mapping[2] && row._status !== 'published' && !ref.navigation)) {
          problems.push(`${ref.path}: ${ref.collection} #${ref.id} needs a published ${audience === 'public' ? 'public' : 'internal'} copy in this site`)
          continue
        }
        // Menus retain links to same-area drafts and hide those destinations
        // during rendering. The audience/site check above still rejects an
        // internal destination in a public menu. Embedded content stays strict.
        if (ref.navigation && mapping[2] && row._status !== 'published') continue
      }
      const collection = req.payload.collections[ref.collection as CollectionSlug]
      if (!collection || (!mapping && !['design-templates', 'design-block-types', 'design-block-designs', 'forms'].includes(ref.collection))) continue
      try {
        const record = await req.payload.findByID({ collection: ref.collection as CollectionSlug, id: ref.id, req: local, depth: 0, draft: false, overrideAccess: false }) as unknown as Record<string, unknown>
        if (record.platformSite && record.platformSite !== site || record._status && record._status !== 'published') {
          problems.push(`${ref.path}: ${ref.collection} #${ref.id} is unavailable for publication`)
          continue
        }
        queue.push(publicDependencyInventory(record, collection.config.fields, ref.collection))
      } catch (error) {
        if (![403, 404].includes(Number((error as { status?: number }).status))) throw error
        problems.push(`${ref.path}: ${ref.collection} #${ref.id} is unavailable for publication`)
      }
    }
  }
  if (problems.length) throw new APIError(`${audience === 'public' ? 'Public' : 'Intranet'} publication requires dependency review: ${[...new Set(problems)].slice(0, 12).join('; ')}. Resolve these references or explicitly create copies in the destination area.`, 400)
}
