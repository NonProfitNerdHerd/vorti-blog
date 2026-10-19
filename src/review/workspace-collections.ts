import { initializeBoardDefaults, starterKeyField, protectStarterFields } from './workspace-starter'
import { workspaceReq } from './workspace-access'
import { boardColors } from './board-colors'
import { userIdentity } from '@design-system/payload-design-core'
import {
  type CollectionConfig,
  type PayloadRequest,
  type Where,
  type CollectionBeforeOperationHook,
} from 'payload'
import { relationID, isAdministrator } from './documents'
import { queueBoardEvent } from './notifications'
import { requireProject, projectWhere } from './project-access'
import { ensureWorkspaceRevisions } from './workspace-revisions'
import {
  boardRole,
  boardWhere,
  canTask,
  internalWorkspace,
  reject,
  requireBoard,
  requireTask,
  taskWhere,
  workspaceDB,
} from './workspace-access'

const signedIn = ({ req }: { req: PayloadRequest }) => !!req.user
const denied = () => false
const hidden = { hidden: true } as const
// Keep trusted inverse-join ACL paths distinct. Payload's SQLite join-alias cache
// uses inverse field names, so client traversals must not pre-seed those aliases.
export const directQueryOnly: CollectionBeforeOperationHook = ({ args, req }) => {
  if (internalWorkspace(req)) return args
  if ('overrideAccess' in args && args.overrideAccess === true) return args
  const query = args as unknown as { where?: unknown; sort?: unknown }
  const check = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) check(item)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      if (key.includes('.'))
        reject('Filter workspace metadata by direct fields, not relationship traversals.', 400)
      check(nested)
    }
  }
  check(query.where)
  for (const sort of Array.isArray(query.sort) ? query.sort : [query.sort])
    if (typeof sort === 'string' && sort.includes('.'))
      reject('Sort workspace metadata by direct fields.', 400)
  return args
}
const relation = (name: string, relationTo: string, required = true) => ({
  name,
  type: 'relationship' as const,
  relationTo: relationTo as 'users',
  required,
  index: true,
})

export const TaskBoards: CollectionConfig = {
  slug: 'task-boards',
  labels: { singular: 'Board', plural: 'Boards' },
  admin: { ...hidden, useAsTitle: 'name' },
  access: {
    read: ({ req }) => (!req.user ? false : isAdministrator(req) ? true : boardWhere(req)),
    create: signedIn,
    update: ({ req }) =>
      !req.user ? false : isAdministrator(req) ? true : boardWhere(req, 'owner'),
    delete: denied,
  },
  fields: [
    starterKeyField,
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'description', type: 'textarea', maxLength: 10000 },
    {
      name: 'presentation',
      type: 'json',
      admin: { hidden: true },
      validate: (value: unknown) => {
        if (value == null) return true
        if (typeof value !== 'object' || Array.isArray(value)) return 'Invalid board presentation.'
        const colors = (value as { priorityColors?: unknown }).priorityColors
        if (colors == null) return true
        if (typeof colors !== 'object' || Array.isArray(colors)) return 'Invalid priority colors.'
        return (
          Object.entries(colors).every(
            ([key, color]) =>
              ['low', 'normal', 'high', 'urgent'].includes(key) &&
              typeof color === 'string' &&
              /^#[0-9a-f]{6}$/i.test(color),
          ) || 'Choose a valid priority and hex color.'
        )
      },
    },
    relation('project', 'task-projects', false),
    { name: 'inheritProject', type: 'checkbox', defaultValue: false, index: true },
    {
      name: 'membershipRevision',
      type: 'number',
      defaultValue: 0,
      admin: hidden,
      access: { create: () => false, update: () => false },
    },
    relation('owner', 'users'),
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'private',
      options: ['private', 'team'],
      index: true,
    },
    { name: 'archived', type: 'checkbox', defaultValue: false, index: true },
    {
      name: 'memberships',
      type: 'join',
      collection: 'task-board-memberships',
      on: 'board',
      defaultLimit: 0,
    },
    {
      name: 'preferences',
      type: 'join',
      collection: 'task-board-preferences',
      on: 'board',
      defaultLimit: 0,
    },
    {
      name: 'directMemberships',
      type: 'join',
      collection: 'task-board-memberships',
      on: 'board',
      defaultLimit: 0,
      access: { read: () => false },
      admin: hidden,
    },
    { name: 'expectedUpdatedAt', type: 'text', virtual: true, admin: hidden },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req, operation }) => {
        if (!req.user) reject('Sign in to create a board.')
        protectStarterFields(data, req)
        await ensureWorkspaceRevisions(workspaceDB(req))
        delete data?.membershipRevision
        if (operation === 'create') data!.owner = req.user.id
        if (operation === 'create') {
          if (data?.project)
            await requireProject(
              req,
              data.project,
              internalWorkspace(req) && data.starterKey ? 'owner' : 'edit',
            )
          else {
            const existing = await req.payload.find({
              collection: 'task-projects',
              req,
              depth: 0,
              overrideAccess: true,
              limit: 1,
              where: {
                and: [
                  { owner: { equals: req.user.id } },
                  { name: { equals: 'My projects' } },
                  { archived: { not_equals: true } },
                ],
              },
            })
            const project =
              existing.docs[0] ??
              (await req.payload.create({
                collection: 'task-projects',
                req,
                depth: 0,
                overrideAccess: false,
                data: { name: 'My projects', owner: req.user.id, visibility: 'private' },
              }))
            data!.project = project.id
          }
        } else if (
          !internalWorkspace(req) &&
          ((data?.project !== undefined &&
            relationID(data.project) !== relationID(originalDoc?.project)) ||
            (data?.inheritProject !== undefined &&
              data.inheritProject !== originalDoc?.inheritProject))
        )
          reject('Use the project sharing confirmation to change inheritance or move boards.')
        if (data?.expectedUpdatedAt && data.expectedUpdatedAt !== originalDoc?.updatedAt)
          reject('This board changed. Reload before saving.', 409)
        if (
          data?.owner &&
          originalDoc?.id &&
          relationID(data.owner) !== relationID(originalDoc.owner)
        ) {
          const role = await boardRole(req, originalDoc.id)
          if (role !== 'owner') reject('Only the owner can transfer a board.')
        }
        if (data?.name) data.name = data.name.trim()
        return data
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req, operation }) => {
        if (operation === 'create') {
          await boardAudit(req, String(doc.id), 'Board created')
          await initializeBoardDefaults(req, doc.id)
        } else
          for (const field of ['name', 'visibility', 'owner', 'archived'])
            if (relationID(doc[field]) !== relationID(previousDoc?.[field]))
              await boardAudit(req, String(doc.id), `Board ${field} changed`)
      },
    ],
    afterRead: [
      async ({ doc, req, overrideAccess }) => {
        if (overrideAccess) return doc
        const owner = await req.payload.findByID({
          collection: 'users',
          id: relationID(doc.owner),
          req,
          overrideAccess: true,
          depth: 0,
        })
        return {
          ...doc,
          ownerLabel: userIdentity(owner),
          workspaceRole: req.user ? await boardRole(req, doc.id) : null,
        }
      },
    ],
  },
  endpoints: [
    {
      path: '/people',
      method: 'get',
      handler: async (req) => {
        if (!req.user) reject('Sign in.', 401)
        const params = new URL(req.url!).searchParams
        const term = (params.get('search') ?? '').slice(0, 35)
        const result = await req.payload.find({
          collection: 'users',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 30,
          where: term
            ? { or: [{ username: { contains: term } }, { attributionLabel: { contains: term } }] }
            : {},
          sort: 'attributionLabel',
        })
        return Response.json({
          docs: result.docs.map((user) => ({
            id: user.id,
            label: userIdentity(user),
            username: user.username,
          })),
        })
      },
    },
  ],
}

export const TaskBoardMemberships: CollectionConfig = {
  slug: 'task-board-memberships',
  admin: hidden,
  access: {
    read: ({ req }) =>
      !req.user ? false : isAdministrator(req) ? true : boardWhere(req, 'read', 'board.'),
    create: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  fields: [
    relation('board', 'task-boards'),
    relation('user', 'users'),
    {
      name: 'role',
      type: 'select',
      required: true,
      options: ['editor', 'commenter', 'viewer'],
      defaultValue: 'viewer',
    },
    { name: 'key', type: 'text', unique: true, required: true, admin: hidden },
    ...['editUser', 'commentUser'].map((name) => ({
      ...relation(name, 'users', false),
      admin: hidden,
    })),
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        const next = { ...originalDoc, ...data }
        await requireBoard(req, next.board, 'owner')
        await ensureWorkspaceRevisions(workspaceDB(req))
        if (
          originalDoc?.id &&
          (relationID(next.board) !== relationID(originalDoc.board) ||
            relationID(next.user) !== relationID(originalDoc.user))
        )
          reject('Memberships cannot move between boards or users.')
        return {
          ...data,
          key: `${relationID(next.board)}:${relationID(next.user)}`,
          editUser: next.role === 'editor' ? next.user : null,
          commentUser: ['editor', 'commenter'].includes(next.role) ? next.user : null,
        }
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const member = await req.payload.findByID({
          collection: 'task-board-memberships',
          id,
          req,
          overrideAccess: true,
          depth: 0,
        })
        await requireBoard(req, member.board, 'owner')
        await ensureWorkspaceRevisions(workspaceDB(req))
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req, operation }) => {
        if (operation === 'create')
          await queueBoardEvent(req, {
            recipient: relationID(doc.user),
            board: relationID(doc.board),
            kind: 'invitation',
            key: `invitation:${doc.id}:${doc.createdAt}`,
          })
        if (operation === 'create' || doc.role !== previousDoc?.role)
          await boardAudit(req, relationID(doc.board), 'Board membership updated')
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        await boardAudit(req, relationID(doc.board), 'Board membership removed')
      },
    ],
  },
}

export const TaskSections: CollectionConfig = {
  slug: 'task-sections',
  admin: hidden,
  access: {
    read: ({ req }) =>
      !req.user ? false : isAdministrator(req) ? true : boardWhere(req, 'read', 'board.'),
    create: signedIn,
    update: signedIn,
    delete: denied,
  },
  fields: [
    relation('board', 'task-boards'),
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'position', type: 'number', defaultValue: 0 },
    { name: 'archived', type: 'checkbox', defaultValue: false },
    { name: 'expectedUpdatedAt', type: 'text', virtual: true, admin: hidden },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        const board = originalDoc?.board ?? data?.board
        await requireBoard(req, board, 'edit')
        if (originalDoc?.id && data?.expectedUpdatedAt !== originalDoc.updatedAt)
          reject('This section changed. Reload before saving.', 409)
        if (originalDoc?.id && data?.board && relationID(board) !== relationID(data.board))
          reject('Sections cannot move between boards.')
        return data
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req }) => {
        if (doc.archived && !previousDoc?.archived)
          await workspaceDB(req)
            .prepare('UPDATE task_placements SET section_id=NULL,updated_at=? WHERE section_id=?')
            .bind(new Date().toISOString(), doc.id)
            .run()
      },
    ],
  },
}

export const TaskPlacements: CollectionConfig = {
  slug: 'task-placements',
  admin: hidden,
  access: {
    read: ({ req }) =>
      !req.user
        ? false
        : isAdministrator(req)
          ? true
          : {
              and: [
                { active: { equals: true } },
                boardWhere(req, 'read', 'board.', 'directMemberships'),
                (isAdministrator(req) ? {} : taskWhere(req, 'read', 'task.')) as Where,
              ],
            },
    create: denied,
    update: denied,
    delete: denied,
  },
  fields: [
    relation('task', 'review-tasks'),
    relation('board', 'task-boards'),
    relation('section', 'task-sections', false),
    { name: 'position', type: 'number', defaultValue: 0 },
    { name: 'key', type: 'text', unique: true, required: true },
    { name: 'active', type: 'checkbox', defaultValue: false, index: true },
  ],
  hooks: {
    beforeOperation: [directQueryOnly],
    beforeChange: [
      ({ req }) => {
        if (!internalWorkspace(req)) reject('Use the task sharing and placement controls.')
      },
    ],
  },
}

export const TaskFollowers: CollectionConfig = {
  slug: 'task-followers',
  admin: hidden,
  access: {
    read: ({ req }) =>
      req.user
        ? {
            and: [
              { user: { equals: req.user.id } },
              (isAdministrator(req) ? {} : taskWhere(req, 'read', 'task.')) as Where,
            ],
          }
        : false,
    create: signedIn,
    update: ({ req }) => (req.user ? { user: { equals: req.user.id } } : false),
    delete: ({ req }) => (req.user ? { user: { equals: req.user.id } } : false),
  },
  fields: [
    relation('task', 'review-tasks'),
    relation('user', 'users'),
    { name: 'key', type: 'text', unique: true, required: true },
    { name: 'following', type: 'checkbox', defaultValue: true },
    { name: 'muted', type: 'checkbox', defaultValue: false },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (!req.user) reject('Sign in.')
        const task = originalDoc?.task ?? data?.task
        if (!internalWorkspace(req)) await requireTask(req, task)
        const user = internalWorkspace(req) ? (data?.user ?? originalDoc?.user) : req.user.id
        if (
          originalDoc?.id &&
          (relationID(task) !== relationID(data?.task ?? task) ||
            relationID(user) !== relationID(originalDoc.user))
        )
          reject('Followers cannot move between tasks or users.')
        return { ...data, user, key: `${relationID(task)}:${relationID(user)}` }
      },
    ],
  },
}

export const TaskBoardPreferences: CollectionConfig = {
  slug: 'task-board-preferences',
  admin: hidden,
  access: {
    read: ({ req }) =>
      req.user
        ? {
            and: [
              { user: { equals: req.user.id } },
              ...(isAdministrator(req) ? [] : [boardWhere(req, 'read', 'board.')]),
            ],
          }
        : false,
    create: signedIn,
    update: ({ req }) => (req.user ? { user: { equals: req.user.id } } : false),
    delete: denied,
  },
  fields: [
    relation('board', 'task-boards'),
    relation('user', 'users'),
    { name: 'key', type: 'text', unique: true, required: true },
    { name: 'favorite', type: 'checkbox', defaultValue: false },
    {
      name: 'iconColor',
      type: 'select',
      options: Object.keys(boardColors),
      admin: { description: 'Your personal board icon color.' },
    },
    { ...relation('favoriteUser', 'users', false), admin: hidden },
    {
      name: 'view',
      type: 'select',
      defaultValue: 'list',
      options: [
        'overview',
        'list',
        'board',
        'calendar',
        'timeline',
        'gantt',
        'dashboard',
        'files',
        'page',
        'messages',
        'embed',
        'workload',
        'timesheets',
      ],
    },
    relation('viewInstance', 'task-views', false),
    { name: 'viewSettings', type: 'json' },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        await requireBoard(req, originalDoc?.board ?? data?.board)
        if (
          originalDoc?.id &&
          data?.board &&
          relationID(data.board) !== relationID(originalDoc.board)
        )
          reject('Preferences cannot move between boards.')
        return {
          ...data,
          user: req.user!.id,
          favoriteUser: (data?.favorite ?? originalDoc?.favorite) ? req.user!.id : null,
          key: `${relationID(originalDoc?.board ?? data?.board)}:${req.user!.id}`,
        }
      },
    ],
  },
}

export const TaskSharingRequests: CollectionConfig = {
  slug: 'task-sharing-requests',
  admin: hidden,
  access: {
    read: ({ req }) =>
      !req.user
        ? false
        : isAdministrator(req)
          ? true
          : {
              and: [
                (isAdministrator(req) ? {} : taskWhere(req, 'read', 'task.')) as Where,
                {
                  or: [
                    { requester: { equals: req.user.id } },
                    { approvers: { equals: req.user.id } },
                  ],
                },
              ],
            },
    create: denied,
    update: denied,
    delete: denied,
  },
  fields: [
    relation('task', 'review-tasks'),
    relation('destination', 'task-boards'),
    relation('requester', 'users'),
    { name: 'approvers', type: 'relationship', relationTo: 'users', hasMany: true },
    { name: 'approved', type: 'relationship', relationTo: 'users', hasMany: true },
    { name: 'fingerprint', type: 'textarea', required: true },
    {
      name: 'state',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: ['pending', 'approved', 'rejected', 'stale'],
    },
  ],
  hooks: {
    beforeOperation: [directQueryOnly],
    beforeChange: [
      ({ req }) => {
        if (!internalWorkspace(req)) reject('Use the sharing approval controls.')
      },
    ],
    afterRead: [
      async ({ doc, req, overrideAccess }) => {
        if (overrideAccess) return doc
        // A request never exposes a destination board the reader cannot access.
        const destination =
          doc.destination && (await boardRole(req, doc.destination)) ? doc.destination : null
        const own = (values: unknown) =>
          Array.isArray(values)
            ? values.filter((id) => isAdministrator(req) || relationID(id) === String(req.user?.id))
            : []
        return {
          ...doc,
          destination,
          approvers: own(doc.approvers),
          approved: own(doc.approved),
          fingerprint: undefined,
        }
      },
    ],
  },
}

export const TaskNotifications: CollectionConfig = {
  slug: 'task-notifications',
  admin: hidden,
  access: {
    read: ({ req }) =>
      req.user
        ? {
            and: [
              { recipient: { equals: req.user.id } },
              {
                or: [
                  {
                    and: [
                      { task: { exists: true } },
                      (isAdministrator(req) ? {} : taskWhere(req, 'read', 'task.')) as Where,
                    ],
                  },
                  {
                    and: [
                      { task: { exists: false } },
                      { board: { exists: true } },
                      isAdministrator(req)
                        ? {}
                        : boardWhere(req, 'read', 'board.', 'directMemberships'),
                    ],
                  },
                  {
                    and: [
                      { task: { exists: false } },
                      { board: { exists: false } },
                      { project: { exists: true } },
                      isAdministrator(req)
                        ? {}
                        : projectWhere(req, 'read', 'project.', 'notificationProjectGrants'),
                    ],
                  },
                  {
                    and: [
                      { projectChange: { exists: true } },
                      { 'projectChange.approvers': { equals: req.user.id } },
                    ],
                  },
                ],
              },
            ],
          }
        : false,
    create: denied,
    update: ({ req }) => (req.user ? { recipient: { equals: req.user.id } } : false),
    delete: denied,
  },
  fields: [
    relation('recipient', 'users'),
    relation('task', 'review-tasks', false),
    relation('board', 'task-boards', false),
    relation('comment', 'review-comments', false),
    relation('request', 'task-sharing-requests', false),
    relation('project', 'task-projects', false),
    relation('thread', 'task-board-messages', false),
    relation('projectChange', 'task-project-changes', false),
    {
      name: 'kind',
      type: 'select',
      options: ['mention', 'assignment', 'invitation', 'comment', 'approval'],
      required: true,
    },
    { name: 'message', type: 'text', required: true },
    { name: 'key', type: 'text', required: true, unique: true },
    { name: 'read', type: 'checkbox', defaultValue: false, index: true },
  ],
  hooks: {
    beforeOperation: [directQueryOnly],
    beforeChange: [
      ({ data, originalDoc, req }) => {
        if (internalWorkspace(req)) return data
        if (!originalDoc || String(req.user?.id) !== relationID(originalDoc.recipient))
          reject('Notifications are generated by the server.')
        for (const key of Object.keys(data))
          if (
            !['read', 'updatedAt', 'createdAt', 'id'].includes(key) &&
            JSON.stringify(data[key]) !== JSON.stringify(originalDoc[key])
          )
            reject('Only notification read status can be changed.')
        return { ...originalDoc, read: data.read ?? originalDoc.read }
      },
    ],
    afterRead: [
      async ({ doc, req }) => {
        if (doc.task && !(await canTask(req, doc.task)))
          return { id: doc.id, read: doc.read, message: 'This item is no longer available.' }
        return doc
      },
    ],
  },
}

export const TaskBoardActivity: CollectionConfig = {
  slug: 'task-board-activity',
  admin: hidden,
  access: {
    read: ({ req }) =>
      !req.user ? false : isAdministrator(req) ? true : boardWhere(req, 'read', 'board.'),
    create: denied,
    update: denied,
    delete: denied,
  },
  fields: [
    relation('board', 'task-boards'),
    relation('actor', 'users', false),
    { name: 'message', type: 'text', required: true },
  ],
  hooks: {
    beforeChange: [
      ({ req }) => {
        if (!internalWorkspace(req)) reject('Activity is generated by the server.')
      },
    ],
  },
}

export async function boardAudit(req: PayloadRequest, board: string, message: string) {
  await req.payload.create({
    collection: 'task-board-activity',
    req: workspaceReq(req),
    overrideAccess: true,
    data: { board: Number(board), actor: req.user?.id, message },
  })
}

type Notification = {
  recipient: string
  task?: string
  board?: string
  comment?: string
  request?: string
  project?: string
  thread?: string
  projectChange?: string
  kind: 'mention' | 'assignment' | 'invitation' | 'comment' | 'approval'
  key: string
  message: string
}
export async function notify(req: PayloadRequest, event: Notification) {
  if (!event.recipient || event.recipient === String(req.user?.id)) return
  if (
    event.task &&
    !(await canTask(
      {
        ...req,
        user: {
          ...(await req.payload.findByID({
            collection: 'users',
            id: event.recipient,
            req,
            depth: 0,
            overrideAccess: true,
          })),
          collection: 'users',
        },
      } as PayloadRequest,
      event.task,
    ))
  )
    return
  const key = `${event.key}:${event.recipient}`
  const exists = await req.payload.count({
    collection: 'task-notifications',
    req,
    overrideAccess: true,
    where: { key: { equals: key } },
  })
  if (exists.totalDocs) return
  try {
    await req.payload.create({
      collection: 'task-notifications',
      req: workspaceReq(req),
      overrideAccess: true,
      data: {
        ...event,
        recipient: Number(event.recipient),
        task: event.task ? Number(event.task) : undefined,
        board: event.board ? Number(event.board) : undefined,
        comment: event.comment ? Number(event.comment) : undefined,
        request: event.request ? Number(event.request) : undefined,
        project: event.project ? Number(event.project) : undefined,
        thread: event.thread ? Number(event.thread) : undefined,
        projectChange: event.projectChange ? Number(event.projectChange) : undefined,
        key,
      },
    })
  } catch (error) {
    // Another retry may have committed the same notification. Never swallow other failures.
    const duplicate = await req.payload.count({
      collection: 'task-notifications',
      req,
      overrideAccess: true,
      where: { key: { equals: key } },
    })
    if (!duplicate.totalDocs) throw error
  }
}

export const workspaceCollections = [
  TaskBoards,
  TaskBoardMemberships,
  TaskSections,
  TaskPlacements,
  TaskFollowers,
  TaskBoardPreferences,
  TaskSharingRequests,
  TaskNotifications,
  TaskBoardActivity,
]
