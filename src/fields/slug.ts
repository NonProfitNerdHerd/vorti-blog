import type { Field } from 'payload'

export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const slugField = (source: string, required = true): Field => ({
  name: 'slug',
  type: 'text',
  unique: true,
  index: true,
  required,
  admin: {
    description: `Generated from ${source} when left empty. You can edit it.`,
  },
  hooks: {
    beforeValidate: [
      ({ value, data }) => {
        if (typeof value === 'string' && value.trim()) return slugify(value)
        const sourceValue = data?.[source]
        return typeof sourceValue === 'string' ? slugify(sourceValue) : value
      },
    ],
  },
})
