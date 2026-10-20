import type { CollectionConfig, CollectionSlug, Payload, PayloadRequest } from 'payload'
import { canManageDesign } from '../access/design'
import {
  defaultView,
  type ViewConfig,
} from '@design-system/payload-design-core'
import { validateView } from './validation'
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
    const templateID = refID(doc.designTemplate)
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
