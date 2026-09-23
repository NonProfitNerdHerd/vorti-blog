import type { CollectionBeforeDeleteHook, CollectionConfig, Field } from 'payload'
import {
  validateAdditionalCSS,
  validateSiteShellNodes,
} from '@design-system/payload-design-core'
import { canManageDesign, isDesignManager } from '../access/design'
import { slugField } from '../fields/slug'

const publishedOrDesignManager = ({ req }: Parameters<NonNullable<CollectionConfig['access']>['read']>[0]) =>
  isDesignManager(req.user as { role?: string } | null | undefined) ? true : { _status: { equals: 'published' } }

const regionSettings = (): Field => ({
  name: 'settings',
  type: 'json',
  defaultValue: { widthMode: 'contained', position: 'static', transparent: false },
  admin: { description: 'Structured region settings for width, spacing, background, border, position, and stacking.' },
})

const shellRegion = (name: 'header' | 'footer', label: string): Field => ({
  name,
  label,
  type: 'group',
  fields: [
    {
      name: 'layout',
      type: 'json',
      required: true,
      defaultValue: [],
      validate: validateSiteShellNodes,
      admin: { description: 'Structured Site Shell nodes. A visual editor will be added in a later phase.' },
    },
    regionSettings(),
  ],
})

export const preventDeletingDefaultSiteTemplate: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const settings = await req.payload.findGlobal({ slug: 'site-settings', depth: 0, overrideAccess: true, req })
  const selected = (settings as typeof settings & { defaultSiteTemplate?: unknown }).defaultSiteTemplate
  const selectedID = typeof selected === 'object' && selected ? selected.id : selected
  if (selectedID != null && String(selectedID) === String(id)) {
    throw new Error('This Site Template is selected as the default in Site Settings and cannot be deleted.')
  }
}

export const SiteTemplates: CollectionConfig = {
  slug: 'site-templates',
  dbName: 'site_tpl',
  labels: { singular: 'Site Template', plural: 'Site Templates' },
  admin: {
    group: 'Site Design',
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', '_status', 'priority', 'updatedAt'],
  },
  access: {
    create: canManageDesign,
    read: publishedOrDesignManager,
    update: canManageDesign,
    delete: canManageDesign,
  },
  hooks: { beforeDelete: [preventDeletingDefaultSiteTemplate] },
  versions: { drafts: { autosave: false }, maxPerDoc: 25 },
  timestamps: true,
  fields: [
    { name: 'name', type: 'text', required: true },
    slugField('name'),
    { name: 'description', type: 'textarea' },
    shellRegion('header', 'Header'),
    shellRegion('footer', 'Footer'),
    { name: 'typography', type: 'json', admin: { description: 'Body and heading fonts, base size, line height, weight, spacing, and H1-H6 settings.' } },
    { name: 'colors', type: 'json', admin: { description: 'Background, surface, text, heading, brand, border, and feedback colors.' } },
    { name: 'buttons', type: 'json', admin: { description: 'Primary and secondary button definitions.' } },
    { name: 'dimensions', type: 'json', admin: { description: 'Content widths, page padding, and section/content spacing.' } },
    { name: 'mobile', type: 'json', admin: { description: 'Breakpoints, mobile spacing, type size, column stacking, and navigation defaults.' } },
    {
      name: 'additionalCSS',
      label: 'Additional CSS',
      type: 'code',
      validate: validateAdditionalCSS,
      maxLength: 50_000,
      admin: { language: 'css', description: 'Stored for future Site Template rendering. It is not rendered in this phase.' },
    },
    {
      name: 'assignment',
      type: 'group',
      fields: [
        { name: 'mode', type: 'select', required: true, defaultValue: 'default', options: [{ label: 'Default', value: 'default' }] },
        { name: 'priority', type: 'number', required: true, defaultValue: 0 },
      ],
    },
  ],
}
