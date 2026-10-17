import type { CollectionConfig } from 'payload'
import { slugField } from '../fields/slug'
import { categoriesEnabledForRequest } from '../lib/system-settings'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { group: 'Content', useAsTitle: 'name', defaultColumns: ['name', 'slug', 'updatedAt'] },
  access: {
    read: () => true,
    create: async ({ req }) => Boolean(req.user) && await categoriesEnabledForRequest(req),
    update: async ({ req }) => Boolean(req.user) && await categoriesEnabledForRequest(req),
    delete: async ({ req }) => Boolean(req.user) && await categoriesEnabledForRequest(req),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    slugField('name'),
    { name: 'description', type: 'textarea' },
    { name: 'image', type: 'upload', relationTo: 'media' },
  ],
}
