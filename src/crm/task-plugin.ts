import { APIError, type CollectionConfig, type CollectionSlug, type Field } from 'payload'
import { crmTaskKeys, validateCRMTaskChange } from './task-access'
import { taskReadWhere } from '../review/workspace-access'
import { crmTaskInternalReadAllowed } from './task-where'
const context: CollectionConfig = {
  slug: 'crm-task-contexts',
  dbName: 'vc_crm_task_contexts',
  timestamps: false,
  lockDocuments: false,
  admin: { hidden: true },
  access: {
    read: ({ req }) => crmTaskInternalReadAllowed(req),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'id', type: 'text', required: true },
    { name: 'task', type: 'relationship', relationTo: 'review-tasks', required: true },
    { name: 'site', type: 'text' },
    { name: 'category', type: 'text' },
  ],
  hooks: {
    beforeChange: [
      () => {
        throw new APIError('CRM task access is database-derived.', 403)
      },
    ],
    beforeDelete: [
      () => {
        throw new APIError('CRM task access is database-derived.', 403)
      },
    ],
  },
}
const constituents: CollectionConfig = {
  ...context,
  slug: 'crm-task-constituents',
  dbName: 'vc_crm_task_constituents',
  fields: [
    { name: 'id', type: 'text', required: true },
    { name: 'task', type: 'relationship', relationTo: 'review-tasks', required: true },
    { name: 'constituent', type: 'text' },
  ],
}
/** Register only with the connected endpoint/editor and reviewed migration. */
export function crmTaskCollections(collections: CollectionConfig[]): CollectionConfig[] {
  return [
    ...collections.map((collection): CollectionConfig => {
      if (collection.slug === 'task-board-activity')
        return {
          ...collection,
          fields: [
            ...collection.fields,
            {
              name: 'task',
              type: 'relationship',
              relationTo: 'review-tasks',
              admin: { hidden: true },
            },
          ],
          access: {
            ...collection.access,
            read: async (args) => {
              const base = await collection.access!.read!(args)
              return base
                ? {
                    and: [
                      ...(base === true ? [] : [base]),
                      { or: [{ task: { exists: false } }, taskReadWhere(args.req, 'task.')] },
                    ],
                  }
                : false
            },
          },
        }
      if (collection.slug !== 'review-tasks') return collection
      return {
        ...collection,
        fields: [
          ...collection.fields,
          ...crmTaskKeys.map((name): Field => {
            const common = {
              name,
              admin: { hidden: true },
              ...(['crmOperationKey', 'crmIntentHash'].includes(name)
                ? { access: { read: () => false } }
                : {}),
            }
            return name.endsWith('Revision')
              ? { ...common, type: 'number' }
              : { ...common, type: 'text' }
          }),
          {
            name: 'crmContext',
            type: 'join',
            collection: 'crm-task-contexts' as CollectionSlug,
            on: 'task',
            defaultLimit: 0,
            maxDepth: 0,
            access: { read: ({ req }) => crmTaskInternalReadAllowed(req) },
            admin: { hidden: true },
          },
          {
            name: 'crmConstituents',
            type: 'join',
            collection: 'crm-task-constituents' as CollectionSlug,
            on: 'task',
            defaultLimit: 0,
            maxDepth: 0,
            access: { read: ({ req }) => crmTaskInternalReadAllowed(req) },
            admin: { hidden: true },
          },
        ],
        forceSelect: {
          ...collection.forceSelect,
          ...Object.fromEntries(crmTaskKeys.map((key) => [key, true])),
        },
        hooks: {
          ...collection.hooks,
          beforeValidate: [
            async ({ req, data, originalDoc, operation }) =>
              validateCRMTaskChange(req, data || {}, originalDoc, operation),
            ...(collection.hooks?.beforeValidate || []),
          ],
          beforeChange: [
            ...(collection.hooks?.beforeChange || []),
            async ({ req, data, originalDoc, operation }) =>
              validateCRMTaskChange(req, data || {}, originalDoc, operation, false),
          ],
          beforeOperation: [
            ({ args, operation }) => {
              if (operation === 'read') {
                const options = args as unknown as { joins?: false | Record<string, unknown> }
                if (options.joins !== false)
                  options.joins = { ...options.joins, crmContext: false, crmConstituents: false }
              }
              return args
            },
            ...(collection.hooks?.beforeOperation || []),
          ],
        },
      }
    }),
    context,
    constituents,
  ]
}
