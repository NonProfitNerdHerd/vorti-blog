import type { Field, Plugin, GroupField } from 'payload'
import { getFieldPaths } from 'payload/shared'
import { validateContentLayout } from '@design-system/payload-design-core'

/** Last field-layout plugin: preserves data paths while grouping plugin-provided fields. */
export const contentWorkspace =
  ({
    enabled = false,
    collections = ['posts', 'pages'],
  }: { enabled?: boolean; collections?: string[] } = {}): Plugin =>
  (config) => {
    for (const collection of config.collections ?? []) {
      if (!collections.includes(collection.slug)) continue
      collection.fields.push({
        name: 'contentLayout',
        type: 'json',
        validate: validateContentLayout,
        admin: { hidden: true },
      })
      if (!enabled) continue
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
      collection.hooks = {
        ...collection.hooks,
        beforeChange: [
          ({ data, originalDoc }) => {
            const template =
              'designTemplate' in data ? data.designTemplate : originalDoc?.designTemplate
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
