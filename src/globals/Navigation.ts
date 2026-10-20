import type { ArrayField, Field, GlobalConfig } from 'payload'
import { authenticated } from '../access/content'
import { legacyMenu, resolveMenu } from '../menus/server'
import { invalidateMenus } from '../menus/collection'

const linkFields = (): Field[] => [
  { name: 'label', type: 'text', required: true },
  {
    name: 'linkType',
    type: 'select',
    required: true,
    defaultValue: 'internal',
    options: [
      { label: 'Internal page', value: 'internal' },
      { label: 'External URL', value: 'external' },
    ],
  },
  {
    name: 'page',
    type: 'relationship',
    relationTo: 'pages',
    admin: { condition: (_, siblingData) => siblingData?.linkType === 'internal' },
    validate: (value: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) =>
      siblingData?.linkType !== 'internal' || Boolean(value) || 'Choose a page.',
  },
  {
    name: 'url',
    type: 'text',
    admin: { condition: (_, siblingData) => siblingData?.linkType === 'external' },
    validate: (value: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) =>
      siblingData?.linkType !== 'external' ||
      (typeof value === 'string' && /^https?:\/\//i.test(value)) ||
      'Enter a full http:// or https:// URL.',
  },
  { name: 'newTab', label: 'Open in new tab', type: 'checkbox', defaultValue: false },
  { name: 'enabled', type: 'checkbox', defaultValue: true },
]

const menuItems = (name: string, label: string): ArrayField => ({
  name,
  label,
  type: 'array',
  admin: { description: 'Drag items to change their display order.' },
  fields: [
    ...linkFields(),
    {
      name: 'children',
      label: 'Submenu items',
      type: 'array',
      fields: linkFields(),
    },
  ],
})

export const Navigation: GlobalConfig = {
  slug: 'navigation',
  label: 'Menus',
  admin: {
    group: 'Site Design',
    components: { views: { edit: { root: { Component: './menus/MenuWorkspace#MenuWorkspace' } } } },
  },
  access: { read: () => true, update: authenticated },
  fields: [
    { name: 'primaryMenu', type: 'relationship', relationTo: 'menus' },
    { name: 'footerMenu', type: 'relationship', relationTo: 'menus' },
    {
      ...menuItems('primary', 'Primary navigation'),
      access: { update: () => false },
      admin: { hidden: true },
    },
    {
      ...menuItems('footer', 'Footer navigation'),
      access: { update: () => false },
      admin: { hidden: true },
    },
    { name: 'expectedUpdatedAt', type: 'text', virtual: true, admin: { hidden: true } },
  ],
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        if (originalDoc?.updatedAt && data.expectedUpdatedAt !== originalDoc.updatedAt)
          throw new Error('Menu locations changed. Reload before saving.')
        return data
      },
    ],
    afterRead: [
      async ({ doc, req }) => {
        const reference = (value: unknown) =>
          value && typeof value === 'object' && 'id' in value ? value.id : value
        for (const slot of ['primary', 'footer'] as const) {
          const id = reference(doc[`${slot}Menu`])
          const menu = id ? await resolveMenu(req.payload, String(id)) : null
          doc[slot] = menu ? legacyMenu(menu.items) : []
        }
        return doc
      },
    ],
    afterChange: [
      ({ doc }) => {
        invalidateMenus()
        return doc
      },
    ],
  },
}
