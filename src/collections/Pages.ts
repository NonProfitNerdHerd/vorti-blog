import type { CollectionConfig } from 'payload'
import { authenticated, publishedOrAuthenticated } from '../access/content'
import { slugField } from '../fields/slug'

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    group: 'Content', useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
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
            {
              name: 'responsiveDesigns',
              type: 'json',
              defaultValue: {},
              admin: { components: { Field: './components/ResponsiveDesignControls#ResponsiveDesignControls' } },
            },
          ],
        },
        {
          label: 'Content',
          admin: { condition: (data) => !data?.designTemplate },
          fields: [{ name: 'content', type: 'richText' }],
        },
        { label: 'Organization', fields: [] },
        { label: 'Publishing', fields: [] },
      ],
    },
  ],
}
