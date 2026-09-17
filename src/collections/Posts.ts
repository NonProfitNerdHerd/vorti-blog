import type { CollectionConfig } from 'payload'
import { authenticated, publishedOrAuthenticated } from '../access/content'
import { slugField } from '../fields/slug'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    group: 'Content',
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', '_status', 'publishedAt', 'updatedAt'],
  },
  access: {
    read: publishedOrAuthenticated,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  versions: { drafts: true },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Content',
          fields: [
            { name: 'title', type: 'text', required: true },
            slugField('title'),
            { name: 'excerpt', type: 'textarea' },
            { name: 'content', type: 'richText', required: true },
            { name: 'featuredImage', type: 'upload', relationTo: 'media' },
          ],
        },
        {
          label: 'Organization',
          fields: [
            { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
            { name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true },
          ],
        },
        {
          label: 'Publishing',
          fields: [
            { name: 'author', type: 'relationship', relationTo: 'users', required: true },
            { name: 'publishedAt', type: 'date' },
            { name: 'featured', type: 'checkbox', defaultValue: false },
            { name: 'allowComments', type: 'checkbox', defaultValue: false },
          ],
        },
      ],
    },
  ],
}
