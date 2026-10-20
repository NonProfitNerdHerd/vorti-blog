import type { Field, GlobalConfig } from 'payload'
import { canManageDesign } from '../access/design'
import { revalidatePath } from 'next/cache'
import { validateSiteSettings } from '../lib/site-settings-validation'

const social = (name: string, label: string): Field => ({ name, label, type: 'text' })

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site Settings',
  admin: { group: 'Admin' },
  access: { read: () => true, update: canManageDesign },
  hooks: {
    beforeValidate: [validateSiteSettings],
    afterChange: [
      ({ doc }) => {
        revalidatePath('/', 'layout')
        return doc
      },
    ],
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'General',
          fields: [
            {
              name: 'settingsHubLink',
              type: 'ui',
              admin: { components: { Field: './components/SettingsHubLink#SettingsHubLink' } },
            },
            { name: 'siteName', type: 'text', required: true, admin: { hidden: true } },
            { name: 'siteTagline', type: 'text', admin: { hidden: true } },
            {
              name: 'timezone',
              type: 'text',
              defaultValue: 'UTC',
              admin: { hidden: true },
              validate: (value: string | null | undefined) => {
                try {
                  new Intl.DateTimeFormat('en-US', { timeZone: value || 'UTC' })
                  return true
                } catch {
                  return 'Choose a valid IANA timezone.'
                }
              },
            },
            {
              name: 'dateFormat',
              type: 'select',
              defaultValue: 'long',
              options: ['long', 'short', 'iso', 'us', 'day-first'],
              admin: { hidden: true },
            },
            {
              name: 'timeFormat',
              type: 'select',
              defaultValue: '12',
              options: ['12', '24'],
              admin: { hidden: true },
            },
            {
              name: 'discourageSearchIndexing',
              type: 'checkbox',
              defaultValue: false,
              admin: { hidden: true },
            },
            {
              name: 'privacyPolicyPage',
              type: 'relationship',
              relationTo: 'pages',
              admin: { hidden: true },
            },
            {
              name: 'showPrivacyPolicyLink',
              type: 'checkbox',
              defaultValue: false,
              admin: { hidden: true },
            },
            { name: 'siteDescription', type: 'textarea' },
            { name: 'logo', type: 'upload', relationTo: 'media' },
            { name: 'darkLogo', label: 'Dark logo', type: 'upload', relationTo: 'media' },
            { name: 'favicon', type: 'upload', relationTo: 'media', admin: { hidden: true } },
            {
              name: 'homepage',
              type: 'relationship',
              relationTo: 'pages',
              admin: { hidden: true },
            },
            {
              name: 'blogPage',
              label: 'Blog page',
              type: 'relationship',
              relationTo: 'pages',
              admin: { hidden: true },
            },
            {
              name: 'defaultSiteTemplate',
              label: 'Default Site Template',
              type: 'relationship',
              relationTo: 'site-templates',
              admin: {
                description: 'The authoritative Site Template used as the global visual shell.',
              },
            },
          ],
        },
        {
          label: 'Branding',
          fields: [
            {
              name: 'primaryColor',
              type: 'text',
              admin: { description: 'Hex color, for example #18243a.' },
            },
            { name: 'secondaryColor', type: 'text' },
            { name: 'accentColor', type: 'text' },
          ],
        },
        {
          label: 'SEO defaults',
          fields: [
            { name: 'defaultSeoTitle', label: 'Default SEO title', type: 'text' },
            { name: 'defaultSeoDescription', label: 'Default SEO description', type: 'textarea' },
            { name: 'defaultSocialImage', type: 'upload', relationTo: 'media' },
          ],
        },
        {
          label: 'Social links',
          fields: [
            social('twitterURL', 'X / Twitter URL'),
            social('youtubeURL', 'YouTube URL'),
            social('facebookURL', 'Facebook URL'),
            social('instagramURL', 'Instagram URL'),
            social('discordURL', 'Discord URL'),
            social('githubURL', 'GitHub URL'),
          ],
        },
        {
          label: 'Footer and contact',
          fields: [
            { name: 'footerDescription', type: 'textarea' },
            { name: 'copyrightText', type: 'text' },
            { name: 'contactEmail', label: 'Public contact email', type: 'email' },
            { name: 'contactInformation', type: 'textarea' },
          ],
        },
      ],
    },
  ],
}
