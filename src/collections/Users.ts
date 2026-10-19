import type { CollectionConfig } from 'payload'
import { slugify } from '../fields/slug'
import { prepareUserIdentity } from '../lib/user-attribution'
import { revalidatePath } from 'next/cache'
import { protectStarterFields } from '../review/workspace-starter'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    group: 'Admin',
    useAsTitle: 'attributionLabel',
    listSearchableFields: ['attributionLabel', 'username', 'email', 'displayName'],
  },
  auth: {
    loginWithUsername: { allowEmailLogin: true, requireEmail: true, requireUsername: false },
  },
  defaultSort: 'email',
  access: {
    create: async ({ req }) =>
      req.user?.role === 'administrator' ||
      (await req.payload.count({ collection: 'users', overrideAccess: true })).totalDocs === 0,
    update: ({ req }) =>
      req.user?.role === 'administrator'
        ? true
        : req.user
          ? { id: { equals: req.user.id } }
          : false,
    delete: ({ req }) => req.user?.role === 'administrator',
  },
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        protectStarterFields(data, req)
        return data
      },
      prepareUserIdentity,
    ],
    // Never accept a client-authored derived label, even when validation is bypassed.
    beforeChange: [
      ({ data, req }) => {
        protectStarterFields(data, req)
        return data
      },
      ({ data, originalDoc, operation, req, context, collection }) =>
        prepareUserIdentity({ data, originalDoc, operation, req, context, collection }),
    ],
    afterChange: [
      ({ doc, previousDoc }) => {
        if (
          previousDoc &&
          [
            'username',
            'email',
            'attributionPreference',
            'displayName',
            'profilePublic',
            'slug',
          ].some((key) => doc[key] !== previousDoc[key])
        ) {
          try {
            revalidatePath('/', 'layout')
          } catch {
            /* Local API jobs outside Next have no route cache. */
          }
        }
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'workspaceInitialized',
      type: 'checkbox',
      defaultValue: false,
      admin: { hidden: true },
      access: { read: () => false, create: () => false, update: () => false },
    },
    {
      name: 'username',
      type: 'text',
      unique: true,
      required: false,
      admin: {
        description:
          '3–32 letters, numbers, dots, underscores, or hyphens. You can sign in with this username or your email.',
      },
    },
    {
      name: 'attributionPreference',
      label: 'Display as',
      type: 'select',
      options: [
        { label: 'Username', value: 'username' },
        { label: 'Email (publicly visible)', value: 'email' },
      ],
      admin: {
        description:
          'Used across the platform, including previous posts and linked items. Leave unchanged to retain legacy attribution.',
        components: { Field: './components/AttributionPreference#AttributionPreference' },
      },
    },
    {
      name: 'attributionLabel',
      type: 'text',
      admin: { hidden: true },
      access: { create: () => false, update: () => false },
    },
    {
      name: 'role',
      type: 'select',
      required: false,
      defaultValue: 'editor',
      access: {
        create: ({ req }) => !req.user || req.user.role === 'administrator',
        update: ({ req }) => req.user?.role === 'administrator',
      },
      options: [
        { label: 'Administrator', value: 'administrator' },
        { label: 'Designer', value: 'designer' },
        { label: 'Editor', value: 'editor' },
      ],
      admin: {
        description:
          'Administrator and Designer can manage global designs. Editor can edit content.',
      },
    },
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
        {
          name: 'slug',
          type: 'text',
          unique: true,
          index: true,
          admin: {
            description:
              'Initialized from your username. Changing your username does not change this profile URL.',
          },
          hooks: {
            beforeValidate: [
              ({ value }) => (typeof value === 'string' && value.trim() ? slugify(value) : value),
            ],
          },
        },
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
