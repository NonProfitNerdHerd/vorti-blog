import { userIdentity } from '@design-system/payload-design-core'
import { APIError, type CollectionConfig, type PayloadRequest, type Where } from 'payload'
import {
  canReviewCollection,
  isAdministrator,
  relationID,
  reviewAccess,
  reviewDocument,
  reviewDocuments,
} from './documents'

const internalActivity = Symbol('review-activity')
const deny = () => false
const authenticated = ({ req }: { req: PayloadRequest }) => !!req.user
const documentFields = [
  {
    name: 'documentType',
    type: 'select' as const,
    required: true,
    index: true,
    options: [...reviewDocuments],
  },
  { name: 'documentID', type: 'text' as const, required: true, index: true },
  {
    name: 'documentDeleted',
    type: 'checkbox' as const,
    defaultValue: false,
    admin: { hidden: true },
  },
]
const fail = (message: string): never => {
  throw new APIError(message, 400)
}
async function taskFor(req: PayloadRequest, id: unknown) {
  return req.payload.findByID({
    collection: 'review-tasks',
    id: relationID(id),
    req,
    overrideAccess: false,
    depth: 0,
  })
}

export const ReviewTasks: CollectionConfig = {
  slug: 'review-tasks',
  labels: { singular: 'Task', plural: 'Tasks' },
  admin: {
    group: 'Review',
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'assignee', 'documentType', 'dueDate'],
    components: { views: { list: { Component: './review/TaskList#TaskList' } } },
  },
  access: {
    read: ({ req }) => reviewAccess(req),
    create: authenticated,
    update: ({ req }) => reviewAccess(req),
    delete: deny,
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 240 },
    { name: 'description', type: 'textarea', maxLength: 20000 },
    ...documentFields,
    { name: 'documentTitle', type: 'text', admin: { readOnly: true } },
    {
      name: 'region',
      type: 'select',
      defaultValue: 'document',
      options: ['document', 'header', 'footer'],
    },
    { name: 'parent', type: 'relationship', relationTo: 'review-tasks', index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      index: true,
      options: [
        { label: 'Open', value: 'open' },
        { label: 'In progress', value: 'in-progress' },
        { label: 'Ready for review', value: 'ready-for-review' },
        { label: 'Done', value: 'done' },
      ],
    },
    {
      name: 'priority',
      type: 'select',
      required: true,
      defaultValue: 'normal',
      options: ['low', 'normal', 'high', 'urgent'],
    },
    { name: 'assignee', type: 'relationship', relationTo: 'users', index: true },
    { name: 'dueDate', type: 'date', admin: { date: { pickerAppearance: 'dayOnly' } } },
    {
      name: 'creator',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true },
      index: true,
    },
    { name: 'archived', type: 'checkbox', defaultValue: false, index: true },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req, operation }) => {
        if (!data || !req.user) fail('Sign in to manage tasks.')
        data.documentDeleted = originalDoc?.documentDeleted ?? false
        if (typeof data.title === 'string') data.title = data.title.trim()
        const next = { ...originalDoc, ...data }
        if (operation === 'update') {
          for (const key of ['documentType', 'documentID', 'region', 'parent', 'creator'])
            if (key in data && relationID(data[key]) !== relationID(originalDoc[key]))
              fail('Task document, parent, and creator cannot be changed.')
        } else {
          data.creator = req.user.id
          if (next.parent) {
            const parent = await taskFor(req, next.parent)
            if (parent.parent) fail('Subtasks cannot have further subtasks.')
            if (parent.archived) fail('Cannot add a subtask to an archived task.')
            if (parent.status === 'done') fail('Reopen the parent before adding subtasks.')
            Object.assign(data, {
              documentType: parent.documentType,
              documentID: parent.documentID,
              region: parent.region,
            })
            Object.assign(next, data)
          }
        }
        if (next.archived !== (originalDoc?.archived ?? false) && !isAdministrator(req))
          fail('Only administrators can archive tasks.')
        const document = await reviewDocument(req, next.documentType, next.documentID)
        if (!document && !(operation === 'update' && isAdministrator(req)))
          fail('Document is unavailable or you do not have review access.')
        if (next.region && next.region !== 'document' && next.documentType !== 'site-templates')
          fail('Regions apply only to Site Templates.')
        if (document)
          data.documentTitle = String(
            ('title' in document ? document.title : 'name' in document ? document.name : '') ||
              next.documentID,
          )
        if (
          next.assignee &&
          (document ||
            (relationID(data.assignee) !== relationID(originalDoc?.assignee) && 'assignee' in data))
        ) {
          const user = await req.payload.findByID({
            collection: 'users',
            id: relationID(next.assignee),
            req,
            overrideAccess: true,
            depth: 0,
          })
          // A valid account must also be able to review the target document.
          const allowed = await reviewDocument(
            { ...req, user } as PayloadRequest,
            next.documentType,
            next.documentID,
          )
          if (!allowed) fail('Assignee cannot review this document.')
        }
        if (next.status === 'done' && originalDoc?.id) {
          const children = await req.payload.count({
            collection: 'review-tasks',
            req,
            overrideAccess: true,
            where: {
              and: [{ parent: { equals: originalDoc.id } }, { status: { not_equals: 'done' } }],
            },
          })
          if (children.totalDocs) fail('Complete all subtasks before completing this task.')
        }
        return data
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req, operation }) => {
        const changes =
          operation === 'create'
            ? ['Task created']
            : ['status', 'assignee', 'archived']
                .filter((key) => relationID(doc[key]) !== relationID(previousDoc?.[key]))
                .map(
                  (key) =>
                    `${key}: ${relationID(previousDoc?.[key]) || 'none'} → ${relationID(doc[key]) || 'none'}`,
                )
        for (const message of changes)
          await req.payload.create({
            collection: 'review-activity',
            req,
            overrideAccess: true,
            context: { [internalActivity]: true },
            data: {
              task: doc.id,
              documentType: doc.documentType,
              documentID: doc.documentID,
              documentDeleted: doc.documentDeleted,
              actor: req.user?.id,
              message,
            },
          })
        if (!doc.parent && doc.archived && !previousDoc?.archived) {
          await req.payload.update({
            collection: 'review-tasks',
            req,
            overrideAccess: false,
            where: { and: [{ parent: { equals: doc.id } }, { archived: { not_equals: true } }] },
            data: { archived: true },
          })
        }
        if (doc.parent && doc.status !== 'done') {
          const parent = await taskFor(req, doc.parent)
          if (parent.status === 'done')
            await req.payload.update({
              collection: 'review-tasks',
              id: parent.id,
              req,
              overrideAccess: false,
              data: { status: 'open' },
            })
        }
        return doc
      },
    ],
  },
  endpoints: [
    {
      path: '/assignees',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const query = new URL(req.url!).searchParams
        const collection = query.get('documentType') ?? 'posts',
          id = query.get('documentID') ?? ''
        if (id && !(await reviewDocument(req, collection, id)))
          return Response.json({ error: 'Unavailable document' }, { status: 403 })
        const users = await req.payload.find({
          collection: 'users',
          req,
          overrideAccess: true,
          pagination: false,
          depth: 0,
        })
        const docs = []
        for (const user of users.docs)
          if (
            id
              ? await reviewDocument({ ...req, user } as PayloadRequest, collection, id)
              : canReviewCollection({ ...req, user } as PayloadRequest, collection)
          )
            docs.push({ id: user.id, label: userIdentity(user, user.displayName || user.email) })
        return Response.json({ docs })
      },
    },
    {
      path: '/:id/document',
      method: 'get',
      handler: async (req) => {
        const task = await taskFor(req, req.routeParams?.id)
        const document = await reviewDocument(req, task.documentType, task.documentID)
        return Response.json({ available: !!document })
      },
    },
  ],
}

export const ReviewComments: CollectionConfig = {
  slug: 'review-comments',
  admin: { hidden: true },
  access: {
    read: ({ req }) => reviewAccess(req),
    create: authenticated,
    delete: deny,
    update: async ({ req }) => {
      const access = await reviewAccess(req)
      if (!access || isAdministrator(req)) return access
      return { and: [access === true ? {} : access, { author: { equals: req.user!.id } }] } as Where
    },
  },
  fields: [
    { name: 'task', type: 'relationship', relationTo: 'review-tasks', required: true, index: true },
    ...documentFields,
    { name: 'author', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    { name: 'body', type: 'textarea', required: true, maxLength: 20000 },
    { name: 'moderated', type: 'checkbox', defaultValue: false },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req, operation }) => {
        if (!req.user || !data) fail('Sign in to comment.')
        if (typeof data.body === 'string') data.body = data.body.trim()
        const task = await taskFor(req, originalDoc?.task ?? data.task)
        if (
          operation === 'update' &&
          'task' in data &&
          relationID(data.task) !== relationID(originalDoc.task)
        )
          fail('Comments cannot move between tasks.')
        if (
          data.moderated !== undefined &&
          data.moderated !== (originalDoc?.moderated ?? false) &&
          !isAdministrator(req)
        )
          fail('Only administrators can moderate comments.')
        Object.assign(data, {
          task: task.id,
          documentType: task.documentType,
          documentID: task.documentID,
          documentDeleted: task.documentDeleted,
          author: originalDoc?.author ?? req.user.id,
        })
        return data
      },
    ],
    afterRead: [
      ({ doc }) =>
        doc.moderated ? { ...doc, body: '[Comment removed by an administrator]' } : doc,
    ],
  },
}

export const ReviewActivity: CollectionConfig = {
  slug: 'review-activity',
  admin: { hidden: true },
  access: { read: ({ req }) => reviewAccess(req), create: deny, update: deny, delete: deny },
  fields: [
    { name: 'task', type: 'relationship', relationTo: 'review-tasks', required: true, index: true },
    ...documentFields,
    { name: 'actor', type: 'relationship', relationTo: 'users' },
    { name: 'message', type: 'text', required: true },
  ],
  hooks: {
    beforeChange: [
      ({ data, context }) => {
        if (!(context as Record<symbol, unknown>)[internalActivity])
          fail('Activity is generated by the server.')
        return data
      },
    ],
  },
}
