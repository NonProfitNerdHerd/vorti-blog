import type { GlobalConfig } from 'payload'
import { revalidatePath } from 'next/cache'

export const SystemSettings: GlobalConfig = {
  slug: 'system-settings',
  label: 'Settings',
  admin: {
    group: 'Site',
    hidden: ({ user }) => user?.role !== 'administrator',
    components: {
      views: { edit: { root: { Component: './components/SettingsHub#SettingsHub' } } },
    },
  },
  access: { read: () => true, update: ({ req }) => req.user?.role === 'administrator' },
  fields: [
    {
      name: 'tagManagementRoles',
      type: 'select',
      hasMany: true,
      defaultValue: ['administrator', 'designer', 'editor'],
      options: ['administrator', 'designer', 'editor'],
      hooks: {
        beforeValidate: [
          ({ value }) => [
            ...new Set([
              'administrator',
              ...(Array.isArray(value) ? value : ['designer', 'editor']),
            ]),
          ],
        ],
      },
    },
    {
      name: 'categoriesEnabled',
      type: 'checkbox',
      defaultValue: true,
      admin: { components: { Field: './components/SystemSettingsTable#SystemSettingsTable' } },
    },
  ],
  hooks: {
    afterChange: [
      ({ doc, req }) => {
        delete req.context.systemCategoriesEnabled
        revalidatePath('/', 'layout')
        return doc
      },
    ],
  },
}
