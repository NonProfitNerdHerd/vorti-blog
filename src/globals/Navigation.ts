import type { Field, GlobalConfig } from 'payload'
import { authenticated } from '../access/content'

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

const menuItems = (name: string, label: string): Field => ({
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
  label: 'Navigation',
  admin: { group: 'Site' },
  access: { read: () => true, update: authenticated },
  fields: [menuItems('primary', 'Primary navigation'), menuItems('footer', 'Footer navigation')],
}
