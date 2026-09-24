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
          label: 'Content',
          fields: [
            { name: 'title', type: 'text', required: true },
            slugField('title'),
            { name: 'content', type: 'richText', required: true },
          ],
        },
        { label: 'Organization', fields: [] },
        { label: 'Publishing', fields: [] },
      ],
    },
  ],
}
