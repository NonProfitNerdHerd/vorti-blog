import type { Access, CollectionSlug, Field, Plugin, TabsField } from 'payload'
import { createDesignCollections } from './collections'
import type { BlockRegistration, DesignEventHandler } from './types'
import { createBlockRegistry } from './registry'
import { slugs } from './types'
import { validateTemplatedContent } from './validation'
import { createPayloadDesignStore } from './payload-store'

export type DesignSystemOptions = {
  enabled?: boolean
  blockCreator?: boolean
  templates?: boolean
  templatableCollections?: string[]
  blockPacks?: BlockRegistration[]
  canManage?: Access
  isDesignManager?: (user: unknown) => boolean
  onPublish?: DesignEventHandler
  lexicalSchemaPaths?: Record<string, string>
}

export function designSystemPlugin(options: DesignSystemOptions = {}): Plugin {
  if (options.templates === true && options.blockCreator === false) throw new Error('Templates require Block Creator')
  createBlockRegistry(options.blockPacks)
  return (config) => {
    if (options.enabled === false) return config
    const contentCollections = options.templatableCollections ?? []
    const existing = new Set(config.collections?.map((collection) => collection.slug))
    for (const slug of contentCollections) if (!existing.has(slug)) throw new Error(`Unknown templatable collection: ${slug}`)
    const added = createDesignCollections({ contentCollections, registeredRendererKeys: options.blockPacks?.map((pack) => pack.rendererKey), canManage: options.canManage, isDesignManager: options.isDesignManager, onPublish: options.onPublish })
    const collections = [...(config.collections ?? []), ...added.filter((collection) =>
      collection.slug === slugs.blockTypes ||
      (options.blockCreator !== false && collection.slug === slugs.blockDesigns) ||
      (options.templates !== false && collection.slug === slugs.templates),
    )]
    for (const collection of collections) {
      if (!contentCollections.includes(collection.slug)) continue
      const templateFields: Field[] = [
        { name: 'designTemplate', label: 'Template', type: 'relationship', relationTo: slugs.templates as CollectionSlug,
          filterOptions: { status: { equals: 'published' }, _status: { equals: 'published' }, allowedCollections: { contains: collection.slug } } },
        { name: 'templateValues', type: 'json', admin: { components: { Field: { path: '@design-system/payload-design-core/admin#TemplateContentEditor', clientProps: { lexicalSchemaPath: options.lexicalSchemaPaths?.[collection.slug] ?? `collection.${collection.slug}.content` } } } } },
      ]
      const tabs = collection.fields.find((field): field is TabsField => field.type === 'tabs')
      const templateTab = tabs?.tabs.find((tab) => 'label' in tab && tab.label === 'Template')
      if (templateTab) {
        const excerptIndex = templateTab.fields.findIndex((field) => 'name' in field && field.name === 'excerpt')
        const insertionIndex = excerptIndex >= 0 ? excerptIndex : templateTab.fields.length
        templateTab.fields = [
          ...templateTab.fields.slice(0, insertionIndex),
          ...templateFields,
          ...templateTab.fields.slice(insertionIndex),
        ]
      }
      else collection.fields = [...collection.fields, ...templateFields]
      collection.fields = [...collection.fields,
        { name: 'designOverrides', type: 'json', defaultValue: {}, hooks: { afterRead: [({ value }) => value ?? {}] }, admin: { hidden: true } },
      ]
      collection.hooks = {
        ...collection.hooks,
        beforeChange: [
          ...(collection.hooks?.beforeChange ?? []),
          async ({ data, originalDoc, req }) => {
            const incomingValues = data.templateValues as Record<string, unknown> | undefined
            // The Admin transports override edits with values; normalize before validation/storage.
            if (incomingValues?.__designOverrides && typeof incomingValues.__designOverrides === 'object') {
              data.designOverrides = { ...(originalDoc?.designOverrides ?? {}), ...(data.designOverrides ?? {}), ...(incomingValues.__designOverrides as Record<string, unknown>) }
              const { __designOverrides, ...contentValues } = incomingValues
              data.templateValues = contentValues
            }
            const reference = data.designTemplate ?? originalDoc?.designTemplate
            const template = typeof reference === 'object' && reference !== null ? reference.id : reference
            if (!template) return data
            const selectedTemplate = await req.payload.findByID({ collection: slugs.templates as CollectionSlug, id: template, depth: 0, overrideAccess: true, req }) as unknown as { allowedCollections?: string[] }
            if (!selectedTemplate.allowedCollections?.includes(collection.slug)) throw new Error(`Template is not allowed for ${collection.slug}`)
            const issues = await validateTemplatedContent(createPayloadDesignStore(req.payload, req), {
              id: originalDoc?.id ?? 'new', template,
              templateValues: data.templateValues ?? originalDoc?.templateValues ?? {},
              designOverrides: data.designOverrides ?? originalDoc?.designOverrides ?? {},
            })
            if (issues.length && data._status !== 'draft') throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
            return data
          },
        ],
      }
    }
    return { ...config, collections }
  }
}
