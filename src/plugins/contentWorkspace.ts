import type { Field, Plugin, GroupField } from 'payload'
import { publishedType, refID } from '../content-framework/collections'
import { protectCategoryValues, categoriesEnabledForRequest } from '../lib/system-settings'
import { getFieldPaths } from 'payload/shared'
import { validateContentLayout, configureEditorHeader } from '@design-system/payload-design-core'

/** Last field-layout plugin: preserves data paths while grouping plugin-provided fields. */
export const contentWorkspace =
  ({
    enabled = false,
    collections = ['posts', 'pages'],
  }: { enabled?: boolean; collections?: string[] } = {}): Plugin =>
  (config) => {
    for (const collection of config.collections ?? []) {
      if (['design-templates', 'site-templates'].includes(collection.slug))
        configureEditorHeader(collection)
      if (!collections.includes(collection.slug)) continue
      collection.fields.push({
        name: 'contentLayout',
        type: 'json',
        validate: (value) => validateContentLayout(value),
        admin: { hidden: true },
      })
      if (!enabled) continue
      configureEditorHeader(collection)
      const fields: Field[] = []
      const groups: Record<string, string[]> = {}
      const add = (items: Field[], group: string) => {
        for (const field of items) {
          if (field.type === 'tabs' && field.tabs.every((tab) => !('name' in tab))) {
            for (const tab of field.tabs)
              add(tab.fields, typeof tab.label === 'string' ? tab.label : group)
            continue
          }
          fields.push(field)
          if ('name' in field && field.name) (groups[group] ??= []).push(field.name)
        }
      }
      add(collection.fields, 'Publishing')
      for (const field of fields) {
        if (field.type === 'text' && field.name === 'title')
          field.admin = { ...field.admin, placeholder: 'Add title' }
        if (
          (field.type === 'json' || field.type === 'richText') &&
          [
            'responsiveDesigns',
            'designOverrides',
            'templateValues',
            'contentLayout',
            'content',
          ].includes(field.name ?? '')
        )
          field.admin = { ...field.admin, hidden: false }
        if (field.type === 'richText' && field.name === 'content') field.validate = () => true
      }
      const group: GroupField = {
        type: 'group',
        label: false,
        fields,
        admin: {
          components: {
            Field: {
              path: '@design-system/payload-design-core/admin#ContentWorkspace',
              clientProps: { groups },
            },
          },
        },
      }
      collection.fields = [group]
      const groupPaths = getFieldPaths({
        field: group,
        index: 0,
        parentIndexPath: '',
        parentPath: '',
        parentSchemaPath: `collection.${collection.slug}`,
      })
      const lexicalFieldIndex = fields.findIndex(
        (field) => 'name' in field && field.name === 'content',
      )
      const lexicalSchemaPath =
        lexicalFieldIndex >= 0
          ? getFieldPaths({
              field: fields[lexicalFieldIndex],
              index: lexicalFieldIndex,
              parentIndexPath: groupPaths.indexPath,
              parentPath: '',
              parentSchemaPath: groupPaths.schemaPath,
            }).schemaPath
          : ''
      group.admin!.components!.Field = {
        path: '@design-system/payload-design-core/admin#ContentWorkspace',
        clientProps: { groups, lexicalSchemaPath },
      }
      const typeValues = fields.find(field => 'name' in field && field.name === 'postTypeValues')
      if (typeValues) typeValues.admin = { ...typeValues.admin, components: { Field: { path: './content-framework/TypeValues#TypeValues', clientProps: { lexicalSchemaPath } } } }
      collection.hooks = {
        ...collection.hooks,
        beforeChange: [
          async ({ data, originalDoc, req }) => {
            const type =
              collection.slug === 'posts'
                ? await publishedType(req.payload, data.postType ?? originalDoc?.postType, req)
                : undefined
            const template =
              ('designTemplate' in data ? data.designTemplate : originalDoc?.designTemplate) ||
              refID(type?.defaultTemplate)
            if (template && data.templateValues && !await categoriesEnabledForRequest(req)) {
              const definition = await req.payload.findByID({ collection: 'design-templates', id: refID(template)!, depth: 0, overrideAccess: false, req })
              const categoryFields = Array.isArray(definition.customFields) ? definition.customFields as Array<{ id: string; relationTo?: string }> : []
              await protectCategoryValues(req, categoryFields, { ...(originalDoc?.templateValues || {}), ...data.templateValues }, originalDoc?.templateValues || {}, 'templateValues')
            }
            for (const key of ['designOverrides', 'responsiveDesigns']) {
              if (
                key in data &&
                JSON.stringify(data[key] ?? {}) !== JSON.stringify(originalDoc?.[key] ?? {}) &&
                Object.keys(data[key] ?? {}).length
              )
                throw new Error('Block design is controlled by the template.')
            }
            if (data.templateValues?.__designOverrides)
              throw new Error('Block design is controlled by the template.')
            if (
              template &&
              data.contentLayout !== undefined &&
              JSON.stringify(data.contentLayout) !==
                JSON.stringify(originalDoc?.contentLayout ?? null)
            )
              throw new Error('Template structure is locked. Only template fields can be edited.')
            if (data.contentLayout) {
              const valid = validateContentLayout(data.contentLayout)
              if (valid !== true) throw new Error(valid)
            }
            return data
          },
          ...(collection.hooks?.beforeChange ?? []),
        ],
      }
    }
    return config
  }
