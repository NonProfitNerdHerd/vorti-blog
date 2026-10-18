import type { GlobalConfig } from 'payload'
import { revalidatePath } from 'next/cache'

export const SystemSettings: GlobalConfig = {
  slug: 'system-settings',
  label: 'Settings',
  admin: {
    group: 'Admin',
    hidden: ({ user }) => user?.role !== 'administrator',
    components: {
      views: { edit: { root: { Component: './components/SettingsHub#SettingsHub' } } },
    },
  },
  access: { read: () => true, update: ({ req }) => req.user?.role === 'administrator' },
  fields: [
    { name:'workspaceEmbedOrigins',type:'json',defaultValue:[],validate:(value:unknown)=>Array.isArray(value)&&value.length<=30&&value.every(origin=>{try{const url=new URL(String(origin));return url.protocol==='https:'&&url.origin===origin&&!url.username&&!url.password}catch{return false}})||'Use up to 30 exact HTTPS origins without paths or credentials.' },
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
