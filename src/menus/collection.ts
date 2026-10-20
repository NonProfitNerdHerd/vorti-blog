import { APIError, type CollectionConfig, type Endpoint, type Plugin } from 'payload'
import { revalidatePath } from 'next/cache'
import { authenticated } from '../access/content'
import { validateMenuItems, type MenuItem } from '@design-system/payload-design-core'
import { resolveMenu } from './server'

export function invalidateMenus() {
  // Hooks also run in migration/test CLIs, outside Next's request context.
  try {
    revalidatePath('/', 'layout')
  } catch (error) {
    if (!String(error).includes('static generation store')) throw error
  }
}
export const Menus: CollectionConfig = {
  slug: 'menus',
  admin: { hidden: true, useAsTitle: 'name' },
  access: {
    read: authenticated,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'items', type: 'json', defaultValue: [], required: true, validate: validateMenuItems },
    {
      name: 'revision',
      type: 'number',
      defaultValue: 0,
      admin: { hidden: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: 'starterKey',
      type: 'text',
      unique: true,
      index: true,
      admin: { hidden: true },
      access: { create: () => false, update: () => false },
    },
    { name: 'expectedUpdatedAt', type: 'text', virtual: true, admin: { hidden: true } },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        if (operation === 'update' && req.user && data.expectedUpdatedAt !== originalDoc.updatedAt)
          throw new APIError(
            'This menu changed. Reload it before saving. Your input has been kept.',
            409,
          )
        data.revision = operation === 'update' ? Number(originalDoc.revision || 0) + 1 : 0
        if (Object.hasOwn(data, 'items')) {
          const validation = validateMenuItems(data.items)
          if (validation !== true) throw new APIError(validation, 400)
        }
        if (data.items) {
          const items = data.items as MenuItem[]
          const previous = (originalDoc?.items || []) as MenuItem[]
          if (
            items.some(
              (item) =>
                item.kind !== 'custom' &&
                item.target == null &&
                !previous.some(
                  (old) => old.key === item.key && old.kind === item.kind && old.target == null,
                ),
            )
          )
            throw new APIError('Choose a destination for every page or post link.', 400)
          for (const [kind, collection] of [
            ['page', 'pages'],
            ['post', 'posts'],
          ] as const) {
            const ids = [
              ...new Set(
                items
                  .filter((item) => item.kind === kind && item.target)
                  .map((item) => item.target!),
              ),
            ]
            for (let index = 0; index < ids.length; index += 75) {
              const batch = ids.slice(index, index + 75)
              const found = await req.payload.find({
                collection,
                where: { id: { in: batch } },
                limit: 75,
                depth: 0,
                overrideAccess: false,
                req,
              })
              // Retain deleted existing references so an unrelated menu edit can still be saved.
              if (
                batch.some(
                  (id) =>
                    !found.docs.some((doc) => doc.id === id) &&
                    !previous.some((item) => item.kind === kind && item.target === id),
                )
              )
                throw new APIError('A selected destination is unavailable.', 400)
            }
          }
        }
        return data
      },
    ],
    afterChange: [
      ({ doc }) => {
        invalidateMenus()
        return doc
      },
    ],
    afterDelete: [
      ({ doc }) => {
        invalidateMenus()
        return doc
      },
    ],
  },
}
export const menuRenderEndpoint: Endpoint = {
  path: '/menu-render/:id',
  method: 'get',
  handler: async (req) => {
    const menu = await resolveMenu(req.payload, String(req.routeParams?.id || ''))
    return Response.json(menu || { error: 'Menu unavailable.' }, {
      status: menu ? 200 : 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  },
}
export const menuInvalidation: Plugin = (config) => {
  for (const collection of config.collections || [])
    if (['pages', 'posts'].includes(collection.slug)) {
      collection.hooks = {
        ...collection.hooks,
        afterChange: [
          ...(collection.hooks?.afterChange || []),
          ({ doc }) => {
            invalidateMenus()
            return doc
          },
        ],
        afterDelete: [
          ...(collection.hooks?.afterDelete || []),
          ({ doc }) => {
            invalidateMenus()
            return doc
          },
        ],
      }
    }
  return config
}
