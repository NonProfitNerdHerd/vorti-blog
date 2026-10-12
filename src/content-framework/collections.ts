import type { CollectionConfig, CollectionSlug, Payload, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'
import { canManageDesign } from '../access/design'
import {
  defaultView,
  listContentCapabilities,
  type TypeField,
  type ViewConfig,
  evaluateFieldRules,
  type MediaFacts,
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
    {
      type: 'row',
      admin: { components: { Field: './content-framework/PostTypeWizard#PostTypeWizard' } },
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
          options: listContentCapabilities().map((item) => ({
            label: item.label,
            value: item.key,
          })),
        },
        { name: 'schemaVersion', type: 'number', defaultValue: 1, admin: { readOnly: true } },
        {
          name: 'fieldDefinitions',
          type: 'json',
          defaultValue: [],
          admin: { components: { Field: './content-framework/FieldsEditor#FieldsEditor' } },
        },
        {
          name: 'templates',
          label: 'Allowed Page/Post Templates',
          type: 'relationship',
          relationTo: 'design-templates',
          hasMany: true,
          filterOptions: {
            and: [
              { _status: { equals: 'published' } },
              { allowedCollections: { contains: 'posts' } },
            ],
          },
        },
        { name: 'defaultTemplate', type: 'relationship', relationTo: 'design-templates' },
        { name: 'archived', type: 'checkbox', defaultValue: false },
      ],
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (!data) return data
        const combined = { ...originalDoc, ...data }
        const invalid = (path: string, message: string): never => {
          throw new ValidationError({ errors: [{ path, message }] })
        }
        for (const path of ['key', 'prefix'] as const) {
          if (typeof combined[path] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(combined[path]))
            invalid(path, 'Use lowercase letters, numbers, and hyphens, starting with a letter.')
        }
        if (
          reservedPrefixes.includes(combined.prefix) &&
          !(combined.key === 'post' && combined.prefix === 'posts')
        )
          invalid('prefix', 'This URL prefix is reserved')
        if (
          originalDoc?.id &&
          ((data.key && data.key !== originalDoc.key) ||
            (data.prefix && data.prefix !== originalDoc.prefix))
        )
          invalid(
            data.key !== undefined && data.key !== originalDoc.key ? 'key' : 'prefix',
            'Type key and prefix are fixed after the first successful save.',
          )
        const fields = (combined.fieldDefinitions || []) as TypeField[]
        validateFields(fields)
        const defaults = Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]))
        const media: MediaFacts = {}
        for (const field of fields) {
          if (field.defaultValue && ['media', 'relationship'].includes(field.kind)) {
            const doc = await req.payload
              .findByID({
                collection: (field.kind === 'media' ? 'media' : field.relationTo) as CollectionSlug,
                id: Number(field.defaultValue),
                overrideAccess: false,
                req,
              })
              .catch((error: unknown) => {
                if (
                  error &&
                  typeof error === 'object' &&
                  'status' in error &&
                  [400, 403, 404].includes(Number(error.status))
                )
                  invalid(
                    'fieldDefinitions',
                    `${field.label} (${field.id}): choose an accessible existing default item.`,
                  )
                throw error
              })
            if (field.kind === 'media') media[field.id] = doc as MediaFacts[string]
          }
        }
        const defaultIssues = evaluateFieldRules(
          fields.map((field) => ({
            ...field,
            required: false,
            rules:
              field.defaultValue === undefined
                ? []
                : field.rules?.filter(
                    (rule) =>
                      rule.kind !== 'requiredWhen' &&
                      (rule.kind !== 'compare' || defaults[rule.field!] !== undefined),
                  ),
          })),
          defaults,
          media,
        )
        if (defaultIssues.length)
          throw new ValidationError({
            errors: defaultIssues.map((issue) => ({
              path: 'fieldDefinitions',
              message: `Invalid default: ${issue.message}`,
            })),
          })
        const capability = listContentCapabilities().find(
          (item) => item.key === combined.capability,
        )
        if (!capability) invalid('capability', 'Choose a registered capability')
        for (const kind of capability.requiredKinds || [])
          if (!fields.some((field) => field.kind === kind && field.required && field.public))
            invalid(
              'fieldDefinitions',
              `${capability.label} requires a public, required ${kind === 'eventSchedule' ? 'Event Schedule' : kind} field. Restore it in Fields.`,
            )
        if (
          combined.capability === 'event' &&
          !fields.some((f) => f.kind === 'eventSchedule' && f.required && f.public)
        )
          invalid(
            'fieldDefinitions',
            'Event types require a public, required Event Schedule field. Restore it in Fields.',
          )
        for (const old of (originalDoc?.fieldDefinitions || []) as TypeField[])
          if (!fields.some((f) => f.id === old.id && f.kind === old.kind))
            invalid(
              'fieldDefinitions',
              `${old.label} (${old.id}): saved fields cannot be removed or change type; add a replacement field.`,
            )
        const templates = (combined.templates || []).map(refID)
        if (combined.defaultTemplate && !templates.includes(refID(combined.defaultTemplate)))
          invalid('defaultTemplate', 'Include the default Template in Allowed Templates.')
        for (const id of templates) {
          const template = await req.payload
            .findByID({
              collection: 'design-templates',
              id,
              depth: 0,
              overrideAccess: false,
              req,
            })
            .catch((error: unknown) => {
              if (
                error &&
                typeof error === 'object' &&
                'status' in error &&
                [400, 403, 404].includes(Number(error.status))
              )
                invalid('templates', 'Choose an accessible published Template allowed for Posts.')
              throw error
            })
          if (
            !(template.allowedCollections || []).includes('posts') ||
            template._status !== 'published'
          )
            invalid('templates', 'Choose published Templates allowed for Posts')
          const visit = (node: unknown): void => {
            if (!node || typeof node !== 'object') return
            if (Array.isArray(node)) {
              node.forEach(visit)
              return
            }
            const obj = node as Record<string, unknown>
            if (obj.source === 'postType' && !fields.some((f) => f.id === obj.fieldId && f.public))
              invalid(
                'templates',
                `Template binds a missing or private Post Type field: ${String(obj.fieldId)}. Make the field public or choose another Template.`,
              )
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
