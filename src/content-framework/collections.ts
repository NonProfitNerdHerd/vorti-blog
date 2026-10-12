import type { CollectionConfig, CollectionSlug, Payload, PayloadRequest } from 'payload'
import { canManageDesign } from '../access/design'
import {
  defaultView,
  listContentCapabilities,
  type TypeField,
  type ViewConfig,
} from '@design-system/payload-design-core'
import { validateFields, validateView, reservedPrefixes } from './validation'
const administrator: NonNullable<CollectionConfig['access']>['create'] = ({ req }) =>
  req.user?.role === 'administrator'
const publishedRead: NonNullable<CollectionConfig['access']>['read'] = ({ req }) =>
  req.user ? true : { _status: { equals: 'published' } }
export const refID = (value: unknown): string | number | undefined =>
  value && typeof value === 'object'
    ? 'id' in value
      ? (value.id as string | number)
      : undefined
    : typeof value === 'string' || typeof value === 'number'
      ? value
      : undefined
export async function publishedType(payload: Payload, id: unknown, req?: PayloadRequest) {
  const reference = refID(id)
  const result = await payload.find({
    collection: 'post-types' as CollectionSlug,
    where: {
      and: [
        reference ? { id: { equals: reference } } : { key: { equals: 'post' } },
        { _status: { equals: 'published' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: false,
    req,
  })
  return result.docs[0] as unknown as Record<string, unknown> | undefined
}
function containsRef(value: unknown, id: string, saved = false): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((v) => containsRef(v, id, saved))
  const object = value as Record<string, unknown>
  if (saved && String(object.viewID ?? '') === id) return true
  return Object.values(object).some((v) => containsRef(v, id, saved))
}
export async function viewUsages(payload: Payload, id: string, req?: PayloadRequest) {
  const usages: Array<{ collection: string; id: string; title: string; url: string }> = []
  async function usesDeclaredView(doc: Record<string, unknown>) {
    const type = doc.postType ? await publishedType(payload, doc.postType, req) : undefined
    const typeValues = (doc.postTypeValues || {}) as Record<string, unknown>
    if (
      ((type?.fieldDefinitions || []) as TypeField[]).some(
        (field) =>
          field.kind === 'relationship' &&
          field.relationTo === 'saved-views' &&
          String(refID(typeValues[field.id])) === id,
      )
    )
      return true
    const templateID = refID(doc.designTemplate) || refID(type?.defaultTemplate)
    if (!templateID) return false
    const template = await payload
      .findByID({
        collection: 'design-templates',
        id: templateID,
        depth: 0,
        draft: false,
        overrideAccess: true,
        req,
      })
      .catch((): null => null)
    const values = (doc.templateValues || {}) as Record<string, unknown>
    return (
      (template?.customFields as Array<{ id: string; fieldType: string; relationTo?: string }>) ||
      []
    ).some(
      (field) =>
        field.fieldType === 'relationship' &&
        field.relationTo === 'saved-views' &&
        String(refID(values[field.id])) === id,
    )
  }
  for (const collection of [
    'posts',
    'pages',
    'design-templates',
    'site-templates',
  ] as CollectionSlug[]) {
    let page = 1
    for (; ; page++) {
      const docs = await payload.find({
        collection,
        where: { _status: { equals: 'published' } },
        depth: 0,
        limit: 100,
        page,
        overrideAccess: false,
        req,
      })
      for (const doc of docs.docs)
        if (
          containsRef(doc, id, true) ||
          (await usesDeclaredView(doc as unknown as Record<string, unknown>))
        )
          usages.push({
            collection,
            id: String(doc.id),
            title: String(
              (doc as unknown as Record<string, unknown>).title ||
                (doc as unknown as Record<string, unknown>).name ||
                doc.id,
            ),
            url: `/admin/collections/${collection}/${doc.id}`,
          })
      if (!docs.hasNextPage) break
    }
  }
  return usages
}
export const PostTypes: CollectionConfig = {
  slug: 'post-types',
  labels: { singular: 'Post Type', plural: 'Post Types' },
  admin: {
    group: 'Site Design',
    useAsTitle: 'singular',
    defaultColumns: ['singular', 'key', 'capability', '_status'],
  },
  access: {
    read: publishedRead,
    create: administrator,
    update: administrator,
    delete: administrator,
  },
  versions: { drafts: true },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true, index: true },
    { name: 'singular', type: 'text', required: true },
    { name: 'plural', type: 'text', required: true },
    { name: 'prefix', type: 'text', required: true, unique: true, index: true },
    {
      name: 'icon',
      type: 'text',
      defaultValue: 'document',
      admin: { components: { Field: './content-framework/TypeIcon#TypeIcon' } },
    },
    {
      name: 'capability',
      type: 'select',
      required: true,
      defaultValue: 'content',
      options: listContentCapabilities().map((item) => ({ label: item.label, value: item.key })),
    },
    { name: 'schemaVersion', type: 'number', defaultValue: 1, admin: { readOnly: true } },
    {
      name: 'fieldDefinitions',
      type: 'json',
      defaultValue: [],
      admin: { components: { Field: './content-framework/FieldsEditor#FieldsEditor' } },
    },
    { name: 'templates', type: 'relationship', relationTo: 'design-templates', hasMany: true },
    { name: 'defaultTemplate', type: 'relationship', relationTo: 'design-templates' },
    { name: 'archived', type: 'checkbox', defaultValue: false },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (!data) return data
        const combined = { ...originalDoc, ...data }
        if (!/^[a-z][a-z0-9-]*$/.test(combined.key) || !/^[a-z][a-z0-9-]*$/.test(combined.prefix))
          throw new Error('Keys and URL prefixes use lowercase letters, numbers, and hyphens')
        if (
          reservedPrefixes.includes(combined.prefix) &&
          !(combined.key === 'post' && combined.prefix === 'posts')
        )
          throw new Error('This URL prefix is reserved')
        if (
          originalDoc?.id &&
          ((data.key && data.key !== originalDoc.key) ||
            (data.prefix && data.prefix !== originalDoc.prefix))
        )
          throw new Error('Type key and prefix are stable after creation')
        const fields = (combined.fieldDefinitions || []) as TypeField[]
        validateFields(fields)
        const capability = listContentCapabilities().find(
          (item) => item.key === combined.capability,
        )
        if (!capability) throw new Error('Choose a registered capability')
        for (const kind of capability.requiredKinds || [])
          if (!fields.some((field) => field.kind === kind && field.required && field.public))
            throw new Error(`${capability.label} requires a public ${kind} field`)
        if (
          combined.capability === 'event' &&
          !fields.some((f) => f.kind === 'eventSchedule' && f.required && f.public)
        )
          throw new Error('Event types require a public, required Event Schedule field')
        for (const old of (originalDoc?.fieldDefinitions || []) as TypeField[])
          if (!fields.some((f) => f.id === old.id && f.kind === old.kind))
            throw new Error(
              'Existing fields cannot be removed or change kind; add a replacement field',
            )
        const templates = (combined.templates || []).map(refID)
        if (combined.defaultTemplate && !templates.includes(refID(combined.defaultTemplate)))
          throw new Error('Default Template must be in the allowed Templates')
        for (const id of templates) {
          const template = await req.payload.findByID({
            collection: 'design-templates',
            id,
            depth: 0,
            overrideAccess: false,
            req,
          })
          if (
            !(template.allowedCollections || []).includes('posts') ||
            template._status !== 'published'
          )
            throw new Error('Choose published Templates allowed for Posts')
          const visit = (node: unknown): void => {
            if (!node || typeof node !== 'object') return
            if (Array.isArray(node)) {
              node.forEach(visit)
              return
            }
            const obj = node as Record<string, unknown>
            if (obj.source === 'postType' && !fields.some((f) => f.id === obj.fieldId && f.public))
              throw new Error('Template binds a missing or private Post Type field')
            Object.values(obj).forEach(visit)
          }
          visit(template.layout)
        }
        return { ...data, schemaVersion: (originalDoc?.schemaVersion || 0) + 1 }
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const used = await req.payload.count({
          collection: 'posts',
          where: { postType: { equals: id } },
          overrideAccess: true,
          req,
        })
        if (used.totalDocs) throw new Error('Archive this Post Type instead; it is used by content')
      },
    ],
  },
}
export const SavedViews: CollectionConfig = {
  slug: 'saved-views',
  labels: { singular: 'Saved View', plural: 'Saved Views' },
  admin: { group: 'Content', useAsTitle: 'name', defaultColumns: ['name', '_status', 'updatedAt'] },
  access: {
    read: publishedRead,
    create: canManageDesign,
    update: canManageDesign,
    delete: canManageDesign,
  },
  versions: { drafts: true },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'configuration',
      type: 'json',
      required: true,
      defaultValue: defaultView,
      admin: { components: { Field: './content-framework/ViewBuilder#ViewBuilder' } },
    },
    {
      name: 'usage',
      type: 'ui',
      admin: { components: { Field: './content-framework/ViewUsage#ViewUsage' } },
    },
  ],
  hooks: {
    beforeOperation: [
      ({ args, operation }) => {
        if (operation === 'update' || operation === 'create')
          args.req.context.savingViewDraft = 'draft' in args && args.draft === true
        return args
      },
    ],
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (data?.configuration) validateView(data.configuration as ViewConfig)
        if (
          originalDoc?._status === 'published' &&
          data?._status === 'draft' &&
          !req.context.savingViewDraft &&
          (await viewUsages(req.payload, String(originalDoc.id), req)).length
        )
          throw new Error(
            'This view is used by published content; keep its published version available',
          )
        return data
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        if ((await viewUsages(req.payload, String(id), req)).length)
          throw new Error('This view is used by published content')
      },
    ],
  },
}
export const EventSeries: CollectionConfig = {
  slug: 'event-series',
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    {
      name: 'post',
      type: 'relationship',
      relationTo: 'posts',
      required: true,
      unique: true,
      index: true,
    },
    { name: 'start', type: 'date', required: true, index: true },
    { name: 'end', type: 'date', required: true, index: true },
    { name: 'recurring', type: 'checkbox', index: true },
    { name: 'schedule', type: 'json', required: true },
  ],
}
