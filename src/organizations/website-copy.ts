import type { CollectionSlug, Config, Field, PayloadRequest } from 'payload'
import { cmsDatabase, cmsSiteContext } from './cms-scope'
import { OrganizationRepository } from './repository'
import { websiteStatus } from './websites'
import { SiteConflictError } from './atomic'
import { safeMenuURL } from '@design-system/payload-design-core'

export const WEBSITE_COPY_KEY = Symbol.for('vorticause.server-website-copy-key')
export const copyCollections = [
  'site-templates',
  'design-templates',
  'design-block-types',
  'design-block-designs',
  'menus',
  'media',
] as const
const eligible = new Set<string>(copyCollections)
export const websiteCopyRecords = (config: Config): Config => ({
  ...config,
  collections: (config.collections || []).map((collection) =>
    !eligible.has(collection.slug)
      ? collection
      : {
          ...collection,
          fields: [
            ...collection.fields,
            {
              name: 'websiteCopyKey',
              type: 'text',
              unique: true,
              admin: { hidden: true },
              access: {
                read: ({ req }) =>
                  typeof (req.context as Record<symbol, unknown>)[WEBSITE_COPY_KEY] === 'string',
                create: () => false,
                update: () => false,
              },
            },
          ],
          hooks: {
            ...collection.hooks,
            beforeChange: [
              ({ data, originalDoc, req }) => {
                data.websiteCopyKey =
                  originalDoc?.websiteCopyKey ||
                  (req.context as Record<symbol, unknown>)[WEBSITE_COPY_KEY] ||
                  null
                return data
              },
              ...(collection.hooks?.beforeChange || []),
            ],
          },
        },
  ),
})

/** Dependency-only copies. Unique server-managed keys make interrupted initialization retryable. */
export async function initializeWebsite(
  req: PayloadRequest,
  siteID: string,
  bucket: R2Bucket,
  expectedRevision?: number,
) {
  const db = cmsDatabase(req),
    repo = new OrganizationRepository(db, Number(req.user!.id))
  const site = await repo.require(siteID, 'content', 'configure')
  if (siteID === 'default') throw new Error('The primary website already exists.')
  const parent = site.parent_id ? await repo.require(site.parent_id, 'content', 'read') : site
  const status = await websiteStatus(db, siteID)
  if (expectedRevision !== undefined && status.revision !== expectedRevision)
    throw new SiteConflictError()
  if (status.initialized) return { site: siteID, initialized: true }
  const scoped = (target: string): PayloadRequest => ({
    ...req,
    context: { ...cmsSiteContext(target) },
  })
  const parentReq = scoped(parent.id),
    childReq = scoped(siteID)
  let presentation: Record<string, unknown>, navigation: Record<string, unknown>
  if (!site.parent_id) {
    presentation = {
      siteName: site.name,
      siteTagline: '',
      timezone: 'UTC',
      dateFormat: 'long',
      timeFormat: '12',
    }
    navigation = {}
  } else if (parent.id === 'default') {
    presentation = (await req.payload.findGlobal({
      slug: 'site-settings',
      req: parentReq,
      depth: 0,
      overrideAccess: false,
    })) as unknown as Record<string, unknown>
    navigation = (await req.payload.findGlobal({
      slug: 'navigation',
      req: parentReq,
      depth: 0,
      overrideAccess: false,
    })) as unknown as Record<string, unknown>
  } else {
    const source = await websiteStatus(db, parent.id)
    if (!source.initialized) throw new Error('Initialize the parent website first.')
    presentation = JSON.parse(source.presentation)
    navigation = JSON.parse(source.navigation)
  }
  async function serial<T, R>(items: T[], map: (item: T) => Promise<R>): Promise<R[]> {
    const result: R[] = []
    for (const item of items) result.push(await map(item))
    return result
  }
  const copied = new Map<string, Promise<number>>()
  const copying = new Set<string>()
  async function copy(collection: string, value: unknown): Promise<number | null> {
    if (value == null) return null
    if (!eligible.has(collection)) return null
    const id = typeof value === 'object' ? (value as { id?: unknown }).id : value
    if (!/^[1-9][0-9]*$/.test(String(id))) throw new Error('Invalid presentation dependency.')
    const key = `${siteID}:${collection}:${id}`
    if (copying.has(key)) throw new Error('Presentation dependencies contain a cycle.')
    if (!copied.has(key))
      copied.set(
        key,
        (async () => {
          const existing = await req.payload.find({
            collection: collection as CollectionSlug,
            req: { ...childReq, context: { ...cmsSiteContext(siteID), [WEBSITE_COPY_KEY]: key } },
            where: { websiteCopyKey: { equals: key } },
            depth: 0,
            limit: 1,
            overrideAccess: false,
          })
          if (existing.docs[0]) return Number(existing.docs[0].id)
          copying.add(key)
          try {
            const source = (await req.payload.findByID({
              collection: collection as CollectionSlug,
              id: Number(id),
              req: parentReq,
              depth: 0,
              overrideAccess: false,
            })) as unknown as Record<string, unknown>
            const schema = req.payload.config.collections.find((item) => item.slug === collection)!
            const data = await fields(schema.fields, source)
            if (collection === 'menus') data.items = externalItems(source.items)
            if (typeof data.slug === 'string') data.slug = `${data.slug}-inherited-${id}`
            if ('_status' in source) data._status = source._status
            let file: { data: Buffer; name: string; mimetype: string; size: number } | undefined
            if (collection === 'media') {
              const object = await bucket.get(String(source.filename))
              if (!object || object.size > 25 * 1024 * 1024)
                throw new Error('A branding asset is unavailable or exceeds the copy limit.')
              const data = Buffer.from(await object.arrayBuffer())
              file = {
                data,
                name: `${siteID}-${String(source.filename)}`,
                mimetype: String(source.mimeType),
                size: data.length,
              }
            }
            const result = await req.payload.create({
              collection: collection as CollectionSlug,
              req: { ...childReq, context: { ...cmsSiteContext(siteID), [WEBSITE_COPY_KEY]: key } },
              data: data as never,
              file,
              overrideAccess: false,
            })
            return Number(result.id)
          } finally {
            copying.delete(key)
          }
        })(),
      )
    return copied.get(key)!
  }
  async function json(value: unknown, key = ''): Promise<unknown> {
    const refs: Record<string, string> = {
      blockType: 'design-block-types',
      blockTypeID: 'design-block-types',
      blockDesign: 'design-block-designs',
      blockDesignID: 'design-block-designs',
      template: 'design-templates',
      templateID: 'design-templates',
      menuID: 'menus',
      mediaID: 'media',
      backgroundImage: 'media',
      foregroundImage: 'media',
    }
    if (
      refs[key] &&
      value != null &&
      (typeof value === 'number' ||
        (typeof value === 'string' && /^[0-9]+$/.test(value)) ||
        (typeof value === 'object' && 'id' in value))
    )
      return copy(refs[key], value)
    if (Array.isArray(value)) return serial(value, (item) => json(item, key))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        await serial(Object.entries(value), async ([name, item]) => [name, await json(item, name)]),
      )
    return value
  }
  async function fields(
    definitions: Field[],
    source: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {}
    for (const field of definitions) {
      if ('tabs' in field) {
        for (const tab of field.tabs) Object.assign(result, await fields(tab.fields, source))
        continue
      }
      if (!('name' in field) || !field.name) {
        if ('fields' in field) Object.assign(result, await fields(field.fields, source))
        continue
      }
      if (
        field.name.startsWith('platform') ||
        [
          'websiteCopyKey',
          'editorSite',
          'id',
          'createdAt',
          'updatedAt',
          'homepage',
          'blogPage',
          'privacyPolicyPage',
        ].includes(field.name) ||
        field.type === 'ui' ||
        ('virtual' in field && field.virtual)
      )
        continue
      const value = source[field.name]
      if (value === undefined) continue
      if (
        (field.type === 'relationship' || field.type === 'upload') &&
        typeof field.relationTo === 'string'
      ) {
        if (field.relationTo === 'users') result[field.name] = value
        else
          result[field.name] = field.hasMany
            ? await serial((value as unknown[]) || [], (item) =>
                copy(field.relationTo as string, item),
              )
            : await copy(field.relationTo, value)
      } else if ('fields' in field && value && typeof value === 'object')
        result[field.name] = Array.isArray(value)
          ? await serial(value, (row) => fields(field.fields, row))
          : await fields(field.fields, value as Record<string, unknown>)
      else result[field.name] = await json(value)
    }
    return result
  }
  const settingSchema = req.payload.config.globals.find((item) => item.slug === 'site-settings')!
  presentation = await fields(settingSchema.fields, presentation)
  presentation.siteName = site.name
  navigation = {
    primaryMenu: await copy('menus', navigation.primaryMenu),
    footerMenu: await copy('menus', navigation.footerMenu),
    primary: externalItems(navigation.primary),
    footer: externalItems(navigation.footer),
  }
  const latest = await repo.require(siteID, 'content', 'configure')
  if (
    (await repo.require(parent.id, 'content', 'read')).authorityRevision !==
      latest.authorityRevision ||
    parent.authorityRevision !== latest.authorityRevision
  )
    throw new SiteConflictError()
  // Copies use independently guarded native mutations. Publication becomes possible only after this final CAS.
  const result = await db.batch([
    db
      .prepare(
        'UPDATE vc_site_websites SET presentation=?,navigation=?,initialized=1,revision=revision+1 WHERE site_id=? AND initialized=0 AND revision=?',
      )
      .bind(JSON.stringify(presentation), JSON.stringify(navigation), siteID, status.revision),
    db
      .prepare('INSERT INTO vc_write_guards(operation_key,affected) VALUES(?,changes())')
      .bind(`initialize:${siteID}`),
    db
      .prepare(
        'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
      )
      .bind(`initialize-epoch:${siteID}`, site.organization_id, latest.authorityRevision + 1),
    db
      .prepare('DELETE FROM vc_write_guards WHERE operation_key IN(?,?)')
      .bind(`initialize:${siteID}`, `initialize-epoch:${siteID}`),
    db
      .prepare(
        'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        site.organization_id,
        siteID,
        Number(req.user!.id),
        'website.initialized',
        'website',
        siteID,
        JSON.stringify({ parent: site.parent_id }),
        `initialize:${siteID}`,
        new Date().toISOString(),
      ),
  ])
  if (!result[0].meta.changes) throw new SiteConflictError()
  return { site: siteID, initialized: true }
}

function externalItems(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  const kept: Record<string, unknown>[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const children = externalItems(item.children) as Record<string, unknown>[]
    if (
      (item.kind === 'custom' || item.linkType === 'external') &&
      safeMenuURL(item.url) &&
      /^(https?:\/\/|mailto:|tel:)/i.test(item.url)
    )
      kept.push({ ...item, children })
    else kept.push(...children)
  }
  // Named menus use flat parent keys; legacy navigation uses nested children.
  // Promote preserved external entries when their uncopied parent was omitted.
  const keys = new Set(kept.map((item) => item.key))
  for (const item of kept)
    if (Object.hasOwn(item, 'parent') && !keys.has(item.parent)) item.parent = null
  return kept
}
