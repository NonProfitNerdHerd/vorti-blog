import type { CollectionConfig } from 'payload'
import { slugField } from '../fields/slug'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    group: 'Admin',
    useAsTitle: 'email',
  },
  auth: true,
  fields: [
    {
      type: 'collapsible',
      label: 'Public author profile',
      fields: [
        {
          name: 'profilePublic',
          type: 'checkbox',
          defaultValue: false,
          admin: { description: 'Only enabled profiles appear on the public author route.' },
        },
        { name: 'displayName', type: 'text' },
        slugField('displayName', false),
        { name: 'profilePhoto', type: 'upload', relationTo: 'media' },
        { name: 'shortBio', type: 'textarea' },
        { name: 'biography', type: 'richText' },
        { name: 'website', type: 'text' },
        { name: 'twitterURL', label: 'X / Twitter URL', type: 'text' },
        { name: 'youtubeURL', label: 'YouTube URL', type: 'text' },
        { name: 'facebookURL', label: 'Facebook URL', type: 'text' },
        { name: 'instagramURL', label: 'Instagram URL', type: 'text' },
        { name: 'githubURL', label: 'GitHub URL', type: 'text' },
      ],
    },
  ],
}
