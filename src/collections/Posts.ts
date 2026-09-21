import type { CollectionConfig } from 'payload'
import { authenticated, publishedOrAuthenticated } from '../access/content'
import { slugField } from '../fields/slug'

const hasRichTextContent = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const root = (value as { root?: { children?: unknown[] } }).root
  return Array.isArray(root?.children) && root.children.length > 0
}

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    group: 'Content',
    useAsTitle: 'title',
    defaultColumns: ['title', 'author', '_status', 'publishedAt', 'updatedAt'],
    components: { edit: { beforeDocumentControls: ['./components/DocumentPreviewActions#DocumentPreviewActions'] } },
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
          label: 'Template',
          fields: [
            { name: 'title', type: 'text', required: true },
            slugField('title'),
            { name: 'excerpt', type: 'textarea' },
          ],
        },
        {
          label: 'Content',
          admin: {
            condition: (data) => !data?.designTemplate,
          },
          fields: [
            {
              name: 'content',
              type: 'richText',
              validate: (value, { siblingData }) => (
                (siblingData as { designTemplate?: unknown })?.designTemplate || hasRichTextContent(value)
                  ? true
                  : 'Content is required when no Template is selected.'
              ),
            },
          ],
        },
        {
          label: 'Featured Image',
          fields: [
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
