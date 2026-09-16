import type { Field, GlobalConfig } from 'payload'
import { authenticated } from '../access/content'

const social = (name: string, label: string): Field => ({ name, label, type: 'text' })

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site Settings',
  admin: { group: 'Site' },
  access: { read: () => true, update: authenticated },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'General',
          fields: [
            { name: 'siteName', type: 'text', required: true },
            { name: 'siteTagline', type: 'text' },
            { name: 'siteDescription', type: 'textarea' },
            { name: 'logo', type: 'upload', relationTo: 'media' },
            { name: 'darkLogo', label: 'Dark logo', type: 'upload', relationTo: 'media' },
            { name: 'favicon', type: 'upload', relationTo: 'media' },
          ],
        },
        {
          label: 'Branding',
          fields: [
            { name: 'primaryColor', type: 'text', admin: { description: 'Hex color, for example #18243a.' } },
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
