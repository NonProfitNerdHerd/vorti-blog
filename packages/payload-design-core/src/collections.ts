import type { Access, CollectionConfig, CollectionSlug } from 'payload'
import { assertDesignCanDelete, assertTemplateCanDelete, getBlockDesignDependencies, getTemplateDependencies } from './dependencies'
import { createPayloadDependencySource } from './payload-store'
import type { DesignEventHandler } from './types'
import { slugs } from './types'
import type { FieldDefinition } from './types'
import { validateFieldDefinitions } from './validation'

export type DesignCollectionsOptions = {
  contentCollections: string[]
  canManage?: Access
  isDesignManager?: (user: unknown) => boolean
  onPublish?: DesignEventHandler
}

const authenticated: Access = ({ req }) => Boolean(req.user)
const primitiveOptions = ['text', 'textarea', 'number', 'boolean', 'select', 'media', 'url', 'date', 'group']

export function createDesignCollections(options: DesignCollectionsOptions): CollectionConfig[] {
  const manage = options.canManage ?? authenticated
  const hiddenFromEditor = ({ user }: { user?: unknown }) => options.isDesignManager ? !options.isDesignManager(user) : !user
  const designRead: Access = async (args) => (await manage(args)) === true ? true : { _status: { equals: 'published' }, status: { equals: 'published' } }
  const common = {
    admin: { group: 'Design' },
    access: { read: designRead, create: manage, update: manage, delete: manage },
    versions: { drafts: true },
  } satisfies Partial<CollectionConfig>

  const blockTypes: CollectionConfig = {
    ...common,
    slug: slugs.blockTypes,
    labels: { singular: 'Block Type', plural: 'Block Creator' },
    admin: { group: 'Design', useAsTitle: 'name', hidden: hiddenFromEditor, defaultColumns: ['name', 'designCount', 'status'] },
    hooks: {
      beforeChange: [async ({ data }) => {
        const issues = validateFieldDefinitions((data.fields ?? []) as FieldDefinition[])
        if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
        return data
      }],
      beforeDelete: [async ({ id, req }) => {
        const designs = await req.payload.find({ collection: slugs.blockDesigns as CollectionSlug, where: { blockType: { equals: id } }, depth: 0, limit: 1, overrideAccess: true, req })
        if (designs.totalDocs) throw new Error('Block Type is referenced by a Block Design; archive or replace its designs first')
      }],
    },
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, unique: true },
      { name: 'description', type: 'textarea' },
      { name: 'rendererKey', type: 'text', required: true },
      { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: ['draft', 'published', 'archived'] },
      { name: 'schemaVersion', type: 'number', defaultValue: 1, required: true, min: 1 },
      { name: 'designCount', label: 'Designs', type: 'number', virtual: true, admin: { readOnly: true }, hooks: {
        afterRead: [async ({ data, req }) => data?.id ? (await req.payload.count({ collection: slugs.blockDesigns as CollectionSlug, where: { blockType: { equals: data.id } }, overrideAccess: true, req })).totalDocs : 0],
      } },
      { name: 'fields', type: 'array', fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'label', type: 'text', required: true },
        { name: 'kind', type: 'select', required: true, options: primitiveOptions },
        { name: 'required', type: 'checkbox' },
        { name: 'children', type: 'array', fields: [
          { name: 'key', type: 'text', required: true },
          { name: 'label', type: 'text', required: true },
          { name: 'kind', type: 'select', required: true, options: primitiveOptions.filter((option) => option !== 'group') },
          { name: 'required', type: 'checkbox' },
        ] },
      ] },
      { name: 'designs', type: 'join', collection: slugs.blockDesigns as CollectionSlug, on: 'blockType', admin: { defaultColumns: ['name', 'status', '_status'] } },
    ],
  }

  const blockDesigns: CollectionConfig = {
    ...common,
    slug: slugs.blockDesigns,
    labels: { singular: 'Block Design', plural: 'Design Variants' },
    admin: { group: false, useAsTitle: 'name', hidden: hiddenFromEditor },
    hooks: {
      beforeChange: [async ({ data, originalDoc, req }) => {
        if (data.status === 'archived' && originalDoc?.status === 'published' && originalDoc.id) {
          await assertDesignCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), originalDoc.id)
        }
        if (data.status === 'published' && data.blockType) {
          const type = await req.payload.findByID({ collection: slugs.blockTypes as CollectionSlug, id: typeof data.blockType === 'object' ? data.blockType.id : data.blockType, depth: 0, overrideAccess: true, req })
          if ((type as { status?: string }).status !== 'published' || (type as { _status?: string })._status !== 'published') throw new Error('Publish the Block Type before publishing this design')
        }
        return data
      }],
      beforeDelete: [async ({ id, req }) => assertDesignCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), id)],
      afterChange: [async ({ doc, req }) => {
        if (doc._status === 'published' && doc.status === 'published') await options.onPublish?.({ type: 'blockDesignPublished', id: doc.id, slug: doc.slug })
        return doc
      }],
    },
    endpoints: [{
      path: '/:id/dependencies', method: 'get',
      handler: async (req) => {
        if ((await manage({ req } as Parameters<Access>[0])) !== true) return Response.json({ error: 'Forbidden' }, { status: 403 })
        const id = req.routeParams?.id
        if (typeof id !== 'string') return Response.json({ error: 'Missing design ID' }, { status: 400 })
        return Response.json(await getBlockDesignDependencies(createPayloadDependencySource(req.payload, options.contentCollections, req), id))
      },
    }],
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, unique: true },
      { name: 'description', type: 'textarea' },
      { name: 'blockType', type: 'relationship', relationTo: slugs.blockTypes as CollectionSlug, required: true },
      { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: ['draft', 'published', 'archived'] },
      { name: 'design', type: 'group', fields: [
        { name: 'alignment', type: 'select', options: ['left', 'center', 'right', 'start', 'end'] },
        { name: 'tone', type: 'select', options: ['neutral', 'accent'] },
        { name: 'width', type: 'select', options: ['content', 'wide', 'full'] },
        { name: 'spacing', type: 'select', options: ['small', 'medium', 'large', 'extra-large', 'compact', 'normal', 'spacious'] },
        { name: 'imageTreatment', type: 'select', options: ['background', 'split', 'feature'] },
        { name: 'overlay', type: 'select', options: ['none', 'light', 'dark'] },
        { name: 'textContrast', type: 'select', options: ['normal', 'light', 'dark'] },
        { name: 'buttonStyle', type: 'select', options: ['primary', 'outline', 'minimal'] },
      ] },
      { name: 'designPreview', type: 'ui', admin: { components: { Field: '@design-system/payload-design-core/admin#BlockDesignPanel' } } },
    ],
  }

  const templates: CollectionConfig = {
    ...common,
    slug: slugs.templates,
    labels: { singular: 'Template', plural: 'Templates' },
    admin: { group: 'Design', useAsTitle: 'name', hidden: hiddenFromEditor },
    hooks: {
      beforeChange: [async ({ data, originalDoc, req }) => {
        if (data.status === 'archived' && originalDoc?.status === 'published' && originalDoc.id) {
          await assertTemplateCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), originalDoc.id)
        }
        if (Array.isArray(data.sections)) {
          const keys = new Set<string>()
          for (const section of data.sections) {
            if (!/^[a-z][a-zA-Z0-9]*$/.test(section.key) || keys.has(section.key)) throw new Error('Template section keys must be unique stable camelCase identifiers')
            keys.add(section.key)
            const id = typeof section.blockDesign === 'object' ? section.blockDesign.id : section.blockDesign
            const design = await req.payload.findByID({ collection: slugs.blockDesigns as CollectionSlug, id, depth: 0, overrideAccess: true, req })
            const blockType = typeof section.blockType === 'object' ? section.blockType.id : section.blockType
            const selectedDesign = design as unknown as { blockType: { id: string | number } | string | number }
            const designType = typeof selectedDesign.blockType === 'object' && selectedDesign.blockType !== null ? selectedDesign.blockType.id : selectedDesign.blockType
            if (String(designType) !== String(blockType)) throw new Error(`Default Design for ${section.name ?? section.key} must belong to its Block Type`)
            if (data.status === 'published' && ((design as { status?: string }).status !== 'published' || (design as { _status?: string })._status !== 'published')) throw new Error(`Publish the Block Design for section ${section.name ?? section.key} first`)
          }
        }
        return data
      }],
      beforeDelete: [async ({ id, req }) => assertTemplateCanDelete(createPayloadDependencySource(req.payload, options.contentCollections, req), id)],
      afterChange: [async ({ doc }) => {
        if (doc._status === 'published' && doc.status === 'published') await options.onPublish?.({ type: 'templatePublished', id: doc.id, slug: doc.slug })
        return doc
      }],
    },
    endpoints: [{ path: '/:id/dependencies', method: 'get', handler: async (req) => {
      if ((await manage({ req } as Parameters<Access>[0])) !== true) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const id = req.routeParams?.id
      if (typeof id !== 'string') return Response.json({ error: 'Missing template ID' }, { status: 400 })
      return Response.json(await getTemplateDependencies(createPayloadDependencySource(req.payload, options.contentCollections, req), id))
    } }],
    fields: [
      { name: 'name', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, unique: true },
      { name: 'description', type: 'textarea' },
      { name: 'status', type: 'select', required: true, defaultValue: 'draft', options: ['draft', 'published', 'archived'] },
      { name: 'allowedCollections', type: 'select', hasMany: true, options: options.contentCollections.map((slug) => ({ label: slug, value: slug })) },
      { name: 'sections', type: 'array', admin: { description: 'Add and reorder sections here. Published changes apply to every linked content item.' }, fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'blockType', type: 'relationship', relationTo: slugs.blockTypes as CollectionSlug, required: true },
        { name: 'blockDesign', type: 'relationship', relationTo: slugs.blockDesigns as CollectionSlug, required: true,
          filterOptions: ({ siblingData }) => {
            const selected = (siblingData as Record<string, unknown> | undefined)?.blockType
            const blockType = typeof selected === 'object' && selected !== null ? (selected as { id?: string | number }).id : selected
            return { status: { equals: 'published' }, _status: { equals: 'published' }, ...(blockType ? { blockType: { equals: blockType } } : {}) }
          },
          admin: { description: 'Choose a published Design belonging to the selected Block Type.' } },
        { name: 'required', type: 'checkbox', defaultValue: false },
        { name: 'allowDesignOverride', type: 'checkbox', defaultValue: false },
      ] },
      { name: 'templateImpact', type: 'ui', admin: { components: { Field: '@design-system/payload-design-core/admin#TemplateImpactPanel' } } },
    ],
  }
  return [blockTypes, blockDesigns, templates]
}
