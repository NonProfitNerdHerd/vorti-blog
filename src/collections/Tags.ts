import type { CollectionConfig } from 'payload'
import { manageTags } from '../access/tags'
import { slugField } from '../fields/slug'

export const Tags: CollectionConfig = {
  slug: 'tags',
  admin: { group: 'Content', useAsTitle: 'name', defaultColumns: ['name', 'slug', 'updatedAt'] },
  access: {
    read: () => true,
    create: manageTags,
    update: manageTags,
    delete: manageTags,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    slugField('name'),
    { name: 'description', type: 'textarea' },
  ],
}
