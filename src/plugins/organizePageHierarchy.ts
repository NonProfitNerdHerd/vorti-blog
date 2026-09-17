import type { Plugin } from 'payload'

// Nested Docs adds these fields after SEO creates the Pages tabs. Move the same
// field objects into the unnamed Organization tab, preserving their data paths.
export const organizePageHierarchy: Plugin = (config) => {
  const pages = config.collections?.find((collection) => collection.slug === 'pages')
  const tabs = pages?.fields.find((field) => field.type === 'tabs')
  if (!pages || !tabs || tabs.type !== 'tabs') return config
  const organization = tabs.tabs.find((tab) => 'label' in tab && tab.label === 'Organization')
  if (!organization) return config
  const hierarchy = pages.fields.filter((field) => 'name' in field && (field.name === 'parent' || field.name === 'breadcrumbs'))
  if (hierarchy.length !== 2) return config

  for (const field of hierarchy) {
    if (field.type === 'relationship' && field.admin) delete field.admin.position
  }
  organization.fields.push(...hierarchy)
  pages.fields = pages.fields.filter((field) => !hierarchy.includes(field))
  return config
}
