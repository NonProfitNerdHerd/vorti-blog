import type { CollectionConfig } from 'payload'
import { authenticated, publishedOrAuthenticated } from '../access/content'
import { slugField } from '../fields/slug'
import { publicationTimestamp } from './publicationTimestamp'

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    group: 'Content',
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
    components: {
      views: { list: { Component: './components/PublicationList#PublicationList' } },
      edit: {
        beforeDocumentControls: ['./components/DocumentPreviewActions#DocumentPreviewActions'],
      },
    },
  },
  access: {
    read: publishedOrAuthenticated,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  versions: { drafts: true },
  hooks: { beforeChange: [publicationTimestamp] },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Template',
          fields: [
            { name: 'title', type: 'text', required: true },
            slugField('title'),
            {
              name: 'responsiveDesigns',
              type: 'json',
              defaultValue: {},
              admin: {
                components: {
                  Field: './components/ResponsiveDesignControls#ResponsiveDesignControls',
                },
              },
            },
          ],
        },
        {
          label: 'Content',
          admin: { condition: (data) => !data?.designTemplate },
          fields: [{ name: 'content', type: 'richText' }],
        },
        { label: 'Organization', fields: [] },
        {
          label: 'Publishing',
          fields: [{ name: 'publishedAt', label: 'Publication date', type: 'date', index: true }],
        },
      ],
    },
  ],
}
