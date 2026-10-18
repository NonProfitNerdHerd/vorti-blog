import { userIdentity } from '@design-system/payload-design-core'
import { APIError, type CollectionConfig, type PayloadRequest, type Where } from 'payload'
import {
  canTask,
  ids,
  internalWorkspace,
  requireBoard,
  requireTask,
  taskWhere,
  workspaceContext,
} from './workspace-access'
import { workspaceEndpoint } from './workspace-service'
import { commentEvent, drainNotifications, taskEvent } from './notifications'
import { canMention, resolveMentions } from './mentions'
import { constantEqual } from '../forms/security'
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
    required: false,
    index: true,
    options: [...reviewDocuments, { label: 'No linked document', value: 'none' }],
  },
  { name: 'documentID', type: 'text' as const, index: true },
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
async function privateDocumentContext({
  doc,
  req,
  overrideAccess,
}: {
  doc: Record<string, unknown>
  req: PayloadRequest
  overrideAccess?: boolean
}) {
  if (
    overrideAccess ||
    !doc.documentType ||
    (await reviewDocument(req, String(doc.documentType), relationID(doc.documentID)))
  )
    return doc
  return {
    ...doc,
    documentType: null,
    documentID: null,
    documentTitle: null,
    documentRestricted: true,
  }
}
async function identityLabels({
  doc,
  req,
  overrideAccess,
}: {
  doc: Record<string, unknown>
  req: PayloadRequest
  overrideAccess?: boolean
}) {
  if (overrideAccess) return doc
  const mentions: import('./mentions').Mention[] = Array.isArray(doc.mentions) ? doc.mentions : []
  const fields = ['author', 'actor', 'assignee']
  const requested = [
    ...new Set([
      ...fields.map((field) => relationID(doc[field])).filter(Boolean),
      ...mentions.map((m) => String(m.user)),
    ]),
  ]
  const users = new Map<string, import('../payload-types').User>()
  for (let offset = 0; offset < requested.length; offset += 30) {
    const result = await req.payload.find({
      collection: 'users',
      req,
      overrideAccess: true,
      depth: 0,
      limit: 30,
      where: { id: { in: requested.slice(offset, offset + 30) } },
    })
    for (const user of result.docs) users.set(String(user.id), user)
  }
  for (const field of fields) {
    const user = users.get(relationID(doc[field]))
    if (user) doc[field + 'Label'] = userIdentity(user)
  }
  doc.mentionLabels = mentions.flatMap((mention) => {
    const user = users.get(String(mention.user))
    return user?.username ? [{ ...mention, username: user.username }] : []
  })
  return doc
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
    update: ({ req }) => taskWhere(req, 'edit'),
    delete: deny,
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 240 },
    { name: 'description', type: 'textarea', maxLength: 20000 },
    { name: 'mentions', type: 'json' },
    { name: 'boards', type: 'relationship', relationTo: 'task-boards', hasMany: true, index: true },
    { name: 'personal', type: 'checkbox', defaultValue: false, admin: { hidden: true } },
    { name: 'expectedUpdatedAt', type: 'text', virtual: true, admin: { hidden: true } },
    { name: 'initialBoard', type: 'number', virtual: true, admin: { hidden: true } },
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
    beforeChange: [
      ({ data, originalDoc }) => {
        // Retain the original NOT NULL storage columns without rebuilding historical tables.
        // An empty pair represents a task with no linked document.
        if (
          !(data.documentType ?? originalDoc?.documentType) &&
          !(data.documentID ?? originalDoc?.documentID)
        ) {
          data.documentType = 'none'
          data.documentID = ''
        }
        return data
      },
    ],
    beforeValidate: [
      async ({ data, originalDoc, req, operation }) => {
        if (!data || !req.user) fail('Sign in to manage tasks.')
        data.documentDeleted = originalDoc?.documentDeleted ?? false
        if (typeof data.title === 'string') data.title = data.title.trim()
        const next = { ...originalDoc, ...data }
        if (data.expectedUpdatedAt && data.expectedUpdatedAt !== originalDoc?.updatedAt)
          throw new APIError('This task changed. Reload it before saving.', 409)
        if (
          !internalWorkspace(req) &&
          'boards' in data &&
          ids(data.boards).join(',') !== ids(originalDoc?.boards).join(',')
        )
          fail('Use the board sharing controls to change task visibility.')
        if (
          !internalWorkspace(req) &&
          'personal' in data &&
          data.personal !== (originalDoc?.personal ?? false)
        )
          fail('Use the board removal controls to make a task personal.')
        if (operation === 'update') {
          for (const key of ['documentType', 'documentID', 'region', 'parent', 'creator'])
            if (key in data && relationID(data[key]) !== relationID(originalDoc[key]))
              fail('Task document, parent, and creator cannot be changed.')
        } else {
          data.creator = req.user.id
          if (data.initialBoard && next.parent) fail('Subtasks inherit their parent’s boards.')
          if (data.initialBoard) {
            await requireBoard(req, data.initialBoard, 'edit')
            data.boards = [Number(data.initialBoard)]
            data.personal = false
            Object.assign(next, data)
          }
          if (!next.documentType && !next.documentID && !next.parent && !data.initialBoard) {
            data.personal = true
            next.personal = true
          }
          if (next.parent) {
            const parent = await requireTask(req, next.parent, 'edit')
            if (parent.parent) fail('Subtasks cannot have further subtasks.')
            if (parent.archived) fail('Cannot add a subtask to an archived task.')
            if (parent.status === 'done') fail('Reopen the parent before adding subtasks.')
            await requireTask(req, parent.id, 'edit')
            Object.assign(data, {
              documentType: parent.documentType,
              documentID: parent.documentID,
              region: parent.region,
              boards: parent.boards,
              personal: parent.personal,
            })
            Object.assign(next, data)
          }
        }
        if (
          next.archived !== (originalDoc?.archived ?? false) &&
          !isAdministrator(req) &&
          !ids(next.boards).length &&
          !next.personal
        )
          fail('Only administrators can archive tasks.')
        const linked = (!!next.documentType && next.documentType !== 'none') || !!next.documentID
        if (linked && (!next.documentType || !next.documentID))
          fail('Choose both document type and document ID.')
        const document = linked
          ? await reviewDocument(req, next.documentType, next.documentID)
          : null
        if (
          linked &&
          !document &&
          !(operation === 'update' && (isAdministrator(req) || ids(next.boards).length))
        )
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
          (operation === 'create' ||
            (relationID(data.assignee) !== relationID(originalDoc?.assignee) && 'assignee' in data))
        ) {
          const user = await req.payload.findByID({
            collection: 'users',
            id: relationID(next.assignee),
            req,
            overrideAccess: true,
            depth: 0,
          })
          const boardTask = ids(next.boards).length > 0
          const allowed =
            operation === 'create' && data.initialBoard
              ? await canMention({ ...req, user } as PayloadRequest, null, {
                  board: data.initialBoard,
                })
              : boardTask || (next.personal && next.parent)
                ? await canTask({ ...req, user } as PayloadRequest, next.parent ?? originalDoc?.id)
                : !linked ||
                  (await reviewDocument(
                    { ...req, user } as PayloadRequest,
                    next.documentType,
                    next.documentID,
                  ))
          if (!allowed) fail('Assignee cannot review this document.')
        }
        if (originalDoc?.id)
          data.mentions = await resolveMentions(
            req,
            originalDoc.id,
            next.description ?? '',
            data.mentions ?? originalDoc.mentions,
            originalDoc.mentions,
          )
        else
          data.mentions = await resolveMentions(
            req,
            null,
            next.description ?? '',
            data.mentions,
            [],
            {
              board: data.initialBoard,
              parent: next.parent,
              creator: req.user.id,
              assignee: next.assignee,
              documentType: next.documentType,
              documentID: next.documentID,
            },
          )
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
        if (operation === 'create' && !doc.parent)
          for (const board of ids(doc.boards)) {
            const last = await req.payload.find({
              collection: 'task-placements',
              req,
              overrideAccess: true,
              depth: 0,
              limit: 1,
              sort: '-position',
              where: { and: [{ board: { equals: board } }, { active: { equals: true } }] },
            })
            await req.payload.create({
              collection: 'task-placements',
              req,
              overrideAccess: true,
              context: workspaceContext,
              data: {
                task: doc.id,
                board: Number(board),
                key: `${doc.id}:${board}`,
                active: true,
                position: (last.docs[0]?.position ?? -1) + 1,
              },
            })
          }
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
      async ({ doc, previousDoc, req, operation }) => {
        await taskEvent(req, doc, previousDoc, operation)
        return doc
      },
    ],
    afterRead: [
      identityLabels,
      async ({ doc, req, overrideAccess }) => {
        if (overrideAccess) return doc
        const canEdit = await canTask(req, doc.id, 'edit')
        const canComment = await canTask(req, doc.id, 'comment')
        const document =
          doc.documentType && doc.documentType !== 'none' && doc.documentID
            ? await reviewDocument(req, doc.documentType, doc.documentID)
            : null
        // Related board IDs are themselves private metadata. SQL authorization uses the stored relations.
        const visible = []
        for (const board of ids(doc.boards)) {
          try {
            await requireBoard(req, board)
            visible.push(Number(board))
          } catch {
            /* Other shared boards stay private. */
          }
        }
        return {
          ...doc,
          boards: visible,
          canEdit,
          canComment,
          ...(doc.documentType === 'none'
            ? { documentType: null, documentID: null }
            : !document && doc.documentType
              ? {
                  documentType: null,
                  documentID: null,
                  documentTitle: null,
                  documentRestricted: true,
                }
              : {}),
        }
      },
    ],
  },
  endpoints: [
    workspaceEndpoint,
    {
      path: '/mention-candidates',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const params = new URL(req.url!).searchParams
        const scope = {
          board: params.get('board'),
          parent: params.get('parent'),
          creator: req.user.id,
          assignee: params.get('assignee'),
          documentType: params.get('documentType') ?? undefined,
          documentID: params.get('documentID') ?? undefined,
        }
        if (!(await canMention(req, null, scope)))
          return Response.json({ error: 'Unavailable task context' }, { status: 403 })
        const search = (params.get('search') ?? '').slice(0, 32)
        const users = await req.payload.find({
          collection: 'users',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 30,
          sort: 'username',
          where: {
            and: [
              { username: { exists: true } },
              ...(search ? [{ username: { contains: search } }] : []),
            ],
          },
        })
        const docs = []
        for (const user of users.docs)
          if (await canMention({ ...req, user } as PayloadRequest, null, scope))
            docs.push({ id: user.id, username: user.username, label: userIdentity(user) })
        return Response.json({ docs })
      },
    },
    {
      path: '/notifications/sync',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        await drainNotifications(req)
        return Response.json({ ok: true })
      },
    },
    {
      path: '/notifications/tick',
      method: 'post',
      handler: async (req) => {
        const secret = process.env.FORM_JOB_TOKEN
        if (
          !secret ||
          secret.length < 32 ||
          !constantEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)
        )
          return Response.json({ error: 'Job authentication required.' }, { status: 403 })
        await drainNotifications(req)
        return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
      },
    },
    {
      path: '/:id/mentions',
      method: 'get',
      handler: async (req) => {
        await requireTask(req, req.routeParams?.id)
        const params = new URL(req.url!).searchParams
        const search = (params.get('search') ?? '').slice(0, 32)
        const users = await req.payload.find({
          collection: 'users',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 30,
          where: {
            and: [
              { username: { exists: true } },
              ...(search ? [{ username: { contains: search } }] : []),
            ],
          },
          sort: 'username',
        })
        const docs = []
        for (const user of users.docs)
          if (await canTask({ ...req, user } as PayloadRequest, req.routeParams?.id))
            docs.push({ id: user.id, username: user.username, label: userIdentity(user) })
        return Response.json({ docs })
      },
    },
    {
      path: '/assignees',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const query = new URL(req.url!).searchParams
        const taskID = query.get('taskID')
        if (taskID) await requireTask(req, taskID)
        const board = query.get('board')
        if (board) await requireBoard(req, board)
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
            board
              ? await canMention({ ...req, user } as PayloadRequest, null, { board })
              : taskID
                ? await canTask({ ...req, user } as PayloadRequest, taskID)
                : id
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
        const document =
          task.documentType && task.documentID
            ? await reviewDocument(req, task.documentType, task.documentID)
            : null
        return Response.json({ available: !!document })
      },
    },
  ],
}

export const ReviewComments: CollectionConfig = {
  slug: 'review-comments',
  admin: { hidden: true },
  access: {
    read: ({ req }) => taskWhere(req, 'read', 'task.'),
    create: authenticated,
    delete: deny,
    update: async ({ req }) => {
      const access = taskWhere(req, 'comment', 'task.')
      if (!access || isAdministrator(req)) return access
      return { and: [access === true ? {} : access, { author: { equals: req.user!.id } }] } as Where
    },
  },
  fields: [
    { name: 'task', type: 'relationship', relationTo: 'review-tasks', required: true, index: true },
    ...documentFields,
    { name: 'author', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    { name: 'body', type: 'textarea', required: true, maxLength: 20000 },
    { name: 'mentions', type: 'json' },
    { name: 'moderated', type: 'checkbox', defaultValue: false },
  ],
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        if (
          !(data.documentType ?? originalDoc?.documentType) &&
          !(data.documentID ?? originalDoc?.documentID)
        ) {
          data.documentType = 'none'
          data.documentID = ''
        }
        return data
      },
    ],
    beforeValidate: [
      async ({ data, originalDoc, req, operation }) => {
        if (!req.user || !data) fail('Sign in to comment.')
        if (typeof data.body === 'string') data.body = data.body.trim()
        const task = await requireTask(req, originalDoc?.task ?? data.task, 'comment')
        await requireTask(req, task.id, 'comment')
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
        data.mentions = await resolveMentions(
          req,
          task.id,
          data.body ?? originalDoc?.body ?? '',
          data.mentions ?? originalDoc?.mentions,
          originalDoc?.mentions,
        )
        return data
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req, operation }) => {
        await commentEvent(req, doc, previousDoc, operation)
        return doc
      },
    ],
    afterRead: [
      identityLabels,
      privateDocumentContext,
      ({ doc }) =>
        doc.moderated ? { ...doc, body: '[Comment removed by an administrator]' } : doc,
    ],
  },
}

export const ReviewActivity: CollectionConfig = {
  slug: 'review-activity',
  admin: { hidden: true },
  access: {
    read: ({ req }) => taskWhere(req, 'read', 'task.'),
    create: deny,
    update: deny,
    delete: deny,
  },
  fields: [
    { name: 'task', type: 'relationship', relationTo: 'review-tasks', required: true, index: true },
    ...documentFields,
    { name: 'actor', type: 'relationship', relationTo: 'users' },
    { name: 'message', type: 'text', required: true },
  ],
  hooks: {
    afterRead: [identityLabels, privateDocumentContext],
    beforeChange: [
      ({ data, context }) => {
        if (!(context as Record<symbol, unknown>)[internalActivity])
          fail('Activity is generated by the server.')
        if (!data.documentType && !data.documentID) {
          data.documentType = 'none'
          data.documentID = ''
        }
        return data
      },
    ],
  },
}
