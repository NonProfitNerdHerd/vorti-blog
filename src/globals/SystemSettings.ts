import type { GlobalConfig } from 'payload'
import { revalidatePath } from 'next/cache'

export const SystemSettings: GlobalConfig = {
  slug: 'system-settings',
  label: 'Settings',
  admin: { group: 'Site', hidden: ({ user }) => user?.role !== 'administrator' },
  access: { read: () => true, update: ({ req }) => req.user?.role === 'administrator' },
  fields: [
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
