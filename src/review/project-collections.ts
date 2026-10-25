import { starterKeyField, protectStarterFields } from './workspace-starter'
import type { CollectionConfig, Field, PayloadRequest } from 'payload'
import { isAdministrator, relationID } from './documents'
import {
  boardWhere,
  internalWorkspace,
  reject,
  requireBoard,
  taskWhere,
  workspaceDB,
} from './workspace-access'
import { projectRole, projectWhere, requireProject } from './project-access'
import { queueBoardEvent } from './notifications'
import { resolveMentions } from './mentions'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { boardAudit, directQueryOnly } from './workspace-collections'
import { userIdentity } from '@design-system/payload-design-core'
import { ensureWorkspaceRevisions } from './workspace-revisions'

export const workspaceViewTypes = [
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
] as const
export const customFieldTypes = [
  'single-select',
  'multi-select',
  'date',
  'people',
  'reference',
  'lookup',
  'text',
  'number',
  'formula',
  'id',
  'timer',
  'time-tracking',
] as const
export const rel = (name: string, relationTo: string, required = true): Field => ({
  name,
  type: 'relationship',
  relationTo: relationTo as 'users',
  required,
  index: true,
})
const signedIn = ({ req }: { req: PayloadRequest }) => !!req.user
export const never = () => false
export function stale(
  data: Record<string, unknown> | undefined,
  originalDoc: Record<string, unknown> | undefined,
) {
  if (originalDoc?.id && data?.expectedUpdatedAt !== originalDoc.updatedAt)
    reject('This record changed. Reload before saving.', 409)
}
const revision: Field = {
  name: 'expectedUpdatedAt',
  type: 'text',
  virtual: true,
  admin: { hidden: true },
}
const hidden = { hidden: true }
async function projectAudit(req: PayloadRequest, project: unknown, message: string, all = false) {
  const boards = await req.payload.find({
    collection: 'task-boards',
    req,
    overrideAccess: true,
    depth: 0,
    pagination: false,
    where: {
      and: [
        { project: { equals: relationID(project) } },
        ...(all ? [] : [{ inheritProject: { equals: true } }]),
      ],
    },
  })
  for (const board of boards.docs) await boardAudit(req, String(board.id), message)
}
const boardAccess = ({ req }: { req: PayloadRequest }) =>
  !req.user ? false : isAdministrator(req) ? true : boardWhere(req, 'read', 'board.')
export const taskRecordAccess = ({ req }: { req: PayloadRequest }) =>
  taskWhere(req, 'read', 'task.')
export function boardRecord(slug: string, fields: Field[], ownerOnly = false): CollectionConfig {
  return {
    slug,
    admin: hidden,
    access: { read: boardAccess, create: signedIn, update: signedIn, delete: signedIn },
    fields: [rel('board', 'task-boards'), ...fields, revision],
    hooks: {
      beforeChange: [
        async ({ data, originalDoc, req }) => {
          if (
            originalDoc?.id &&
            relationID(originalDoc.board) !== relationID(data.board ?? originalDoc.board)
          )
            reject('Records cannot move between boards.')
          await requireBoard(req, data.board ?? originalDoc?.board, ownerOnly ? 'owner' : 'edit')
          if (ownerOnly) await requireBoard(req, data.board ?? originalDoc?.board, 'edit')
          if (originalDoc?.id && !internalWorkspace(req)) stale(data, originalDoc)
          return data
        },
      ],
      beforeDelete: [
        async ({ req, id }) => {
          const doc = await req.payload.findByID({
            collection: slug as 'task-views',
            id,
            req,
            depth: 0,
            overrideAccess: true,
          })
          await requireBoard(req, doc.board, ownerOnly ? 'owner' : 'edit')
          if (ownerOnly) await requireBoard(req, doc.board, 'edit')
        },
      ],
    },
  }
}
export const TaskProjects: CollectionConfig = {
  slug: 'task-projects',
  admin: { ...hidden, useAsTitle: 'name' },
  access: {
    read: ({ req }) => (!req.user ? false : isAdministrator(req) ? true : projectWhere(req)),
    create: signedIn,
    update: ({ req }) =>
      !req.user ? false : isAdministrator(req) ? true : projectWhere(req, 'owner'),
    delete: never,
  },
  fields: [
    starterKeyField,
    { name: 'name', type: 'text', required: true, maxLength: 120 },
    { name: 'description', type: 'textarea', maxLength: 10000 },
    rel('owner', 'users', false),
    {
      name: 'visibility',
      type: 'select',
      options: ['private', 'team'],
      defaultValue: 'private',
      required: true,
    },
    { name: 'archived', type: 'checkbox', defaultValue: false, index: true },
    {
      name: 'membershipRevision',
      type: 'number',
      defaultValue: 0,
      admin: hidden,
      access: { create: () => false, update: () => false },
    },
    {
      name: 'projectGrants',
      type: 'join',
      collection: 'task-project-memberships',
      on: 'project',
      defaultLimit: 0,
    },
    {
      name: 'directProjectGrants',
      type: 'join',
      collection: 'task-project-memberships',
      on: 'project',
      defaultLimit: 0,
      access: { read: () => false },
      admin: hidden,
    },
    {
      name: 'notificationProjectGrants',
      type: 'join',
      collection: 'task-project-memberships',
      on: 'project',
      defaultLimit: 0,
      access: { read: () => false },
      admin: hidden,
    },
    {
      name: 'projectPreferences',
      type: 'join',
      collection: 'task-project-preferences',
      on: 'project',
      defaultLimit: 0,
      access: { read: () => false },
      admin: hidden,
    },
    revision,
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        if (!req.user) reject('Sign in.', 401)
        protectStarterFields(data, req)
        await ensureWorkspaceRevisions(workspaceDB(req))
        delete data.membershipRevision
        if (!originalDoc?.id) data.owner = req.user!.id
        else {
          await requireProject(req, originalDoc.id, 'owner')
          if (!internalWorkspace(req)) stale(data, originalDoc)
        }
        if (
          data.owner &&
          originalDoc?.id &&
          relationID(data.owner) !== relationID(originalDoc.owner)
        ) {
          const target = await req.payload.findByID({
            collection: 'users',
            id: relationID(data.owner),
            req,
            depth: 0,
            overrideAccess: true,
          })
          if (!target) reject('Select an existing owner.', 400)
        }
        return data
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
          workspaceRole: await projectRole(req, doc.id),
        }
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req, operation }) => {
        if (operation === 'update')
          await projectAudit(
            req,
            doc.id,
            doc.archived !== previousDoc?.archived
              ? doc.archived
                ? 'Project archived'
                : 'Project restored'
              : 'Project settings updated',
            doc.archived !== previousDoc?.archived,
          )
      },
    ],
  },
}
export const TaskProjectMemberships: CollectionConfig = {
  slug: 'task-project-memberships',
  admin: hidden,
  access: {
    read: ({ req }) =>
      !req.user ? false : isAdministrator(req) ? true : projectWhere(req, 'read', 'project.'),
    create: signedIn,
    update: signedIn,
    delete: signedIn,
  },
  fields: [
    rel('project', 'task-projects'),
    rel('user', 'users', false),
    {
      name: 'role',
      type: 'select',
      required: true,
      options: ['editor', 'commenter', 'viewer'],
      defaultValue: 'viewer',
    },
    { name: 'key', type: 'text', required: false, unique: true, admin: hidden },
    rel('editUser', 'users', false),
    rel('commentUser', 'users', false),
    revision,
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const next = { ...originalDoc, ...data }
        await requireProject(req, next.project, 'owner')
        await ensureWorkspaceRevisions(workspaceDB(req))
        if (originalDoc?.id) {
          stale(data, originalDoc)
          if (
            relationID(next.project) !== relationID(originalDoc.project) ||
            relationID(next.user) !== relationID(originalDoc.user)
          )
            reject('Memberships cannot move.')
        }
        return {
          ...data,
          key: `${relationID(next.project)}:${relationID(next.user)}`,
          editUser: next.role === 'editor' ? next.user : null,
          commentUser: ['editor', 'commenter'].includes(next.role) ? next.user : null,
        }
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const doc = await req.payload.findByID({
          collection: 'task-project-memberships',
          id,
          req,
          depth: 0,
          overrideAccess: true,
        })
        await requireProject(req, doc.project, 'owner')
        await ensureWorkspaceRevisions(workspaceDB(req))
      },
    ],
    afterChange: [
      async ({ doc, req, operation }) => {
        await projectAudit(req, doc.project, 'Project membership updated')
        if (operation === 'create')
          await queueBoardEvent(req, {
            recipient: relationID(doc.user),
            project: relationID(doc.project),
            kind: 'invitation',
            key: `project-invite:${doc.id}:${doc.createdAt}`,
          })
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        await projectAudit(req, doc.project, 'Project membership removed')
      },
    ],
    afterRead: [
      async ({ doc, req, overrideAccess }) => {
        if (overrideAccess) return doc
        const user = await req.payload.findByID({
          collection: 'users',
          id: relationID(doc.user),
          req,
          overrideAccess: true,
          depth: 0,
        })
        return { ...doc, userLabel: userIdentity(user) }
      },
    ],
  },
}
export const TaskProjectPreferences: CollectionConfig = {
  slug: 'task-project-preferences',
  admin: hidden,
  access: {
    read: ({ req }) => (req.user ? { user: { equals: req.user.id } } : false),
    create: signedIn,
    update: ({ req }) => (req.user ? { user: { equals: req.user.id } } : false),
    delete: never,
  },
  fields: [
    rel('project', 'task-projects'),
    rel('user', 'users', false),
    { name: 'key', type: 'text', required: false, unique: true },
    { name: 'favorite', type: 'checkbox' },
    { name: 'expanded', type: 'checkbox', defaultValue: true },
  ],
  hooks: {
    beforeChange: [
      async ({ req, data, originalDoc }) => {
        const project = data.project ?? originalDoc?.project
        await requireProject(req, project)
        if (originalDoc?.id && relationID(project) !== relationID(originalDoc.project))
          reject('Preferences cannot move.')
        return { ...data, user: req.user!.id, key: `${project}:${req.user!.id}` }
      },
    ],
  },
}
export const TaskViews = boardRecord(
  'task-views',
  [
    { name: 'name', type: 'text', required: true, maxLength: 80 },
    { name: 'kind', type: 'select', required: true, options: [...workspaceViewTypes] },
    { name: 'position', type: 'number', defaultValue: 0 },
    { name: 'defaultView', type: 'checkbox' },
    { name: 'configuration', type: 'json' },
  ],
  true,
)
TaskViews.hooks!.beforeChange!.push(async ({ data, originalDoc, req }) => {
  const next = { ...originalDoc, ...data }
  if (originalDoc?.id && data.kind && data.kind !== originalDoc.kind)
    reject('Create a new view instead of changing its type.', 400)
  if (next.configuration && JSON.stringify(next.configuration).length > 16000)
    reject('View configuration is too large.', 400)
  if (next.kind === 'embed' && next.configuration?.url) {
    const settings = await req.payload.findGlobal({
      slug: 'system-settings',
      req,
      overrideAccess: true,
    })
    try {
      const url = new URL(next.configuration.url)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !Array.isArray(settings.workspaceEmbedOrigins) ||
        !settings.workspaceEmbedOrigins.includes(url.origin)
      )
        reject('Choose an HTTPS URL from an administrator-approved origin.', 400)
    } catch {
      reject('Choose an HTTPS URL from an administrator-approved origin.', 400)
    }
  }
  return data
})
export const TaskBoardFields = boardRecord(
  'task-board-fields',
  [
    rel('field', 'task-field-definitions'),
    { name: 'position', type: 'number', defaultValue: 0 },
    { name: 'key', type: 'text', required: false, unique: true },
  ],
  true,
)
TaskBoardFields.hooks!.beforeChange!.push(async ({ data, originalDoc, req }) => {
  const field = relationID(data.field ?? originalDoc?.field)
  if (!originalDoc?.id || field !== relationID(originalDoc.field)) {
    const definition = await req.payload.findByID({
      collection: 'task-field-definitions',
      id: field,
      req,
      overrideAccess: false,
      depth: 0,
    })
    if (definition.archived) reject('Restore this definition before adding its column.', 409)
  }
  return { ...data, key: `${relationID(data.board ?? originalDoc?.board)}:${field}` }
})
export const TaskBoardPages = boardRecord('task-board-pages', [
  rel('view', 'task-views'),
  {
    name: 'body',
    type: 'richText',
    required: true,
    editor: lexicalEditor({
      features: ({ defaultFeatures }) =>
        defaultFeatures.filter(
          (feature) => !['upload', 'blocks', 'relationship'].includes(feature.key),
        ),
    }),
  },
])
TaskBoardPages.fields.push({ name: 'key', type: 'text', unique: true })
TaskBoardPages.hooks!.beforeChange!.push(async ({ data, originalDoc, req }) => {
  const view = await req.payload.findByID({
    collection: 'task-views',
    id: relationID(data.view ?? originalDoc?.view),
    req,
    overrideAccess: false,
    depth: 0,
  })
  if (
    view.kind !== 'page' ||
    relationID(view.board) !== relationID(data.board ?? originalDoc?.board)
  )
    reject('Choose a Page view on this board.', 400)
  return { ...data, key: `${view.id}` }
})
export const TaskBaselines = boardRecord(
  'task-baselines',
  [
    { name: 'name', type: 'text', required: true },
    { name: 'snapshot', type: 'json', required: true, access: { read: () => false } },
  ],
  true,
)
TaskBaselines.access!.create = never
TaskBaselines.access!.update = never
TaskBaselines.access!.delete = never

export const TaskFieldDefinitions: CollectionConfig = {
  slug: 'task-field-definitions',
  admin: { ...hidden, useAsTitle: 'name' },
  access: { read: signedIn, create: signedIn, update: signedIn, delete: never },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 80 },
    { name: 'kind', type: 'select', required: true, options: [...customFieldTypes] },
    rel('creator', 'users', false),
    { name: 'configuration', type: 'json' },
    { name: 'systemKey', type: 'text', unique: true, admin: { hidden: true } },
    { name: 'archived', type: 'checkbox', defaultValue: false },
    revision,
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        if (!req.user) reject('Sign in.', 401)
        if (
          data.systemKey !== undefined &&
          !internalWorkspace(req) &&
          data.systemKey !== originalDoc?.systemKey
        )
          reject('System field identities are server-managed.')
        if (!originalDoc?.id && !isAdministrator(req)) {
          const [boards, projects] = await Promise.all([
            req.payload.count({
              collection: 'task-boards',
              req,
              overrideAccess: true,
              where: { owner: { equals: req.user!.id } },
            }),
            req.payload.count({
              collection: 'task-projects',
              req,
              overrideAccess: true,
              where: { owner: { equals: req.user!.id } },
            }),
          ])
          if (!boards.totalDocs && !projects.totalDocs)
            reject('Only board or project owners can create reusable fields.')
        }
        if (!originalDoc?.id) data.creator = req.user!.id
        else {
          stale(data, originalDoc)
          if (!isAdministrator(req)) {
            if (relationID(originalDoc.creator) !== String(req.user!.id))
              reject('Only the creator or an administrator can change this field.')
            const reuse = await req.payload.count({
              collection: 'task-board-fields',
              req,
              overrideAccess: true,
              where: {
                and: [
                  { field: { equals: originalDoc.id } },
                  { 'board.owner': { not_equals: req.user!.id } },
                ],
              },
            })
            if (reuse.totalDocs)
              reject('An administrator must approve changes to fields reused by another owner.')
          }
          const values = await req.payload.count({
            collection: 'task-field-values',
            req,
            overrideAccess: true,
            where: { field: { equals: originalDoc.id } },
          })
          if (values.totalDocs && data.kind && data.kind !== originalDoc.kind)
            reject('Create a replacement field instead of changing a type with saved values.', 400)
          if (data.creator && relationID(data.creator) !== relationID(originalDoc.creator))
            reject('Field creators cannot change.')
        }
        const { validateFieldDefinition } = await import('./workspace-fields')
        await validateFieldDefinition(req, { ...originalDoc, ...data })
        return data
      },
    ],
  },
}
export const TaskFieldValues: CollectionConfig = {
  slug: 'task-field-values',
  admin: hidden,
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    rel('task', 'review-tasks'),
    rel('field', 'task-field-definitions'),
    { name: 'key', type: 'text', required: false, unique: true },
    { name: 'value', type: 'json' },
    revision,
  ],
}
export const TaskDependencies: CollectionConfig = {
  slug: 'task-dependencies',
  admin: hidden,
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    rel('task', 'review-tasks'),
    rel('predecessor', 'review-tasks'),
    rel('project', 'task-projects'),
    { name: 'key', type: 'text', required: false, unique: true },
  ],
}
export const TaskAttachments: CollectionConfig = {
  slug: 'task-attachments',
  admin: hidden,
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    rel('board', 'task-boards', false),
    rel('task', 'review-tasks', false),
    rel('comment', 'review-comments', false),
    rel('uploader', 'users'),
    { name: 'filename', type: 'text', required: true },
    { name: 'objectKey', type: 'text', required: true, unique: true },
    { name: 'mimeType', type: 'text', required: true },
    { name: 'size', type: 'number', required: true },
    {
      name: 'state',
      type: 'select',
      options: ['staged', 'ready', 'deleting'],
      defaultValue: 'staged',
      index: true,
    },
  ],
}
export const TaskTimeEntries: CollectionConfig = {
  slug: 'task-time-entries',
  admin: hidden,
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    rel('task', 'review-tasks'),
    rel('user', 'users', false),
    rel('field', 'task-field-definitions', false),
    { name: 'startedAt', type: 'date', required: true, index: true },
    { name: 'endedAt', type: 'date', index: true },
    { name: 'seconds', type: 'number', defaultValue: 0 },
    { name: 'note', type: 'textarea', maxLength: 2000 },
    { name: 'history', type: 'json' },
    { name: 'activeUserKey', type: 'text', unique: true },
    revision,
  ],
}
export const TaskTimeAudit: CollectionConfig = {
  slug: 'task-time-audit',
  admin: hidden,
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    rel('task', 'review-tasks'),
    rel('entry', 'task-time-entries'),
    rel('actor', 'users'),
    rel('entryUser', 'users'),
    { name: 'action', type: 'text', required: true },
    { name: 'reason', type: 'text' },
    { name: 'beforeValue', type: 'json' },
    { name: 'afterValue', type: 'json' },
    { name: 'operationKey', type: 'text', unique: true, required: true },
    { name: 'fingerprint', type: 'text', required: true },
  ],
  hooks: {
    beforeChange: [() => reject('Time audit records are generated only by the time service.')],
    beforeDelete: [() => reject('Time audit records cannot be deleted.')],
  },
}
export const TaskCountdowns: CollectionConfig = {
  slug: 'task-countdowns',
  admin: hidden,
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    rel('task', 'review-tasks'),
    rel('user', 'users', false),
    rel('field', 'task-field-definitions'),
    { name: 'key', type: 'text', required: false, unique: true },
    { name: 'endsAt', type: 'date' },
    { name: 'remainingSeconds', type: 'number' },
  ],
}
export const TaskCapacities: CollectionConfig = {
  slug: 'task-capacities',
  admin: hidden,
  access: { read: signedIn, create: signedIn, update: signedIn, delete: never },
  fields: [
    rel('user', 'users', false),
    { name: 'userKey', type: 'text', unique: true, required: false },
    { name: 'weeklyHours', type: 'number', min: 0, max: 168, defaultValue: 40 },
    { name: 'weekdays', type: 'json', defaultValue: [1, 2, 3, 4, 5] },
    revision,
  ],
  hooks: {
    beforeChange: [
      ({ data, req, originalDoc }) => {
        if (
          !isAdministrator(req) &&
          relationID(data.user ?? originalDoc?.user) !== String(req.user?.id)
        )
          reject('Only administrators can change another user’s capacity.')
        if (originalDoc?.id) stale(data, originalDoc)
        const weekdays = data.weekdays ?? originalDoc?.weekdays ?? [1, 2, 3, 4, 5]
        if (
          !Array.isArray(weekdays) ||
          weekdays.length > 7 ||
          new Set(weekdays).size !== weekdays.length ||
          weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
        )
          reject('Choose distinct working days from Monday through Sunday.', 400)
        if (Number(data.weeklyHours ?? originalDoc?.weeklyHours ?? 40) > 0 && !weekdays.length)
          reject('Choose at least one working day for a positive weekly capacity.', 400)
        return { ...data, userKey: relationID(data.user ?? originalDoc?.user) }
      },
    ],
  },
}
export const TaskBoardMessages = boardRecord('task-board-messages', [
  rel('author', 'users', false),
  rel('parent', 'task-board-messages', false),
  { name: 'body', type: 'textarea', required: true, maxLength: 10000 },
  { name: 'mentions', type: 'json' },
])
TaskBoardMessages.hooks!.beforeChange = [
  async ({ data, originalDoc, req }) => {
    if (!req.user) reject('Sign in.', 401)
    const board = data.board ?? originalDoc?.board,
      role = await requireBoard(req, board)
    if (role === 'viewer') reject('Commenting permission is required.')
    await requireBoard(req, board, 'read')
    const boardDoc = await req.payload.findByID({
      collection: 'task-boards',
      id: relationID(board),
      req,
      overrideAccess: true,
      depth: 0,
    })
    if (boardDoc.archived) reject('Restore this board before commenting.', 409)
    if (boardDoc.project) {
      const project = await req.payload.findByID({
        collection: 'task-projects',
        id: relationID(boardDoc.project),
        req,
        overrideAccess: true,
        depth: 0,
      })
      if (project.archived) reject('Restore this project before commenting.', 409)
    }
    if (originalDoc?.id) {
      stale(data, originalDoc)
      if (relationID(originalDoc.author) !== String(req.user!.id) && role !== 'owner')
        reject('Only the author or owner can edit a message.')
      if (
        relationID(data.board ?? originalDoc.board) !== relationID(originalDoc.board) ||
        relationID(data.parent ?? originalDoc.parent) !== relationID(originalDoc.parent)
      )
        reject('Messages cannot move.')
    }
    if (data.parent) {
      const parent = await req.payload.findByID({
        collection: 'task-board-messages',
        id: relationID(data.parent),
        req,
        overrideAccess: false,
        depth: 0,
      })
      if (parent.parent || relationID(parent.board) !== relationID(board))
        reject('Replies must belong to a top-level message on this board.', 400)
    }
    const mentions = await resolveMentions(
      req,
      null,
      String(data.body ?? originalDoc?.body ?? ''),
      data.mentions,
      originalDoc?.mentions,
      { board },
    )
    return { ...data, author: originalDoc?.author ?? req.user!.id, mentions }
  },
]
TaskBoardMessages.hooks!.afterChange = [
  async ({ doc, previousDoc, req }) => {
    const recipients = new Map<string, 'comment' | 'mention'>()
    const thread = doc.parent ?? doc.id
    const ownFollow = await req.payload.count({
      collection: 'task-message-followers',
      req,
      overrideAccess: true,
      where: { key: { equals: `${relationID(thread)}:${req.user!.id}` } },
    })
    if (!ownFollow.totalDocs)
      await req.payload.create({
        collection: 'task-message-followers',
        req,
        overrideAccess: false,
        data: { thread: Number(relationID(thread)), user: req.user!.id, following: true },
      })
    const followers = await req.payload.find({
      collection: 'task-message-followers',
      req,
      overrideAccess: true,
      depth: 0,
      limit: 100,
      where: { thread: { equals: relationID(thread) } },
    })
    for (const follower of followers.docs)
      if (follower.following) recipients.set(relationID(follower.user), 'comment')
    const old = new Set(
      (Array.isArray(previousDoc?.mentions) ? previousDoc.mentions : []).map(
        (m: { user: number }) => m.user,
      ),
    )
    for (const mention of Array.isArray(doc.mentions) ? doc.mentions : [])
      if (!old.has(mention.user)) recipients.set(String(mention.user), 'mention')
    for (const [recipient, kind] of recipients)
      await queueBoardEvent(req, {
        recipient,
        board: relationID(doc.board),
        thread: relationID(thread),
        kind,
        key: `board-message:${doc.id}:${doc.updatedAt}`,
      })
  },
]
TaskBoardMessages.access!.delete = never
TaskBoardMessages.hooks!.afterRead = [
  async ({ doc, req }) => {
    const author = await req.payload.findByID({
      collection: 'users',
      id: relationID(doc.author),
      req,
      overrideAccess: true,
      depth: 0,
    })
    let displayBody = String(doc.body)
    for (const mention of [...(Array.isArray(doc.mentions) ? doc.mentions : [])].sort(
      (a, b) => b.start - a.start,
    )) {
      const user = await req.payload.findByID({
        collection: 'users',
        id: mention.user,
        req,
        overrideAccess: true,
        depth: 0,
      })
      if (user.username)
        displayBody =
          displayBody.slice(0, mention.start) + `@${user.username}` + displayBody.slice(mention.end)
    }
    return { ...doc, authorLabel: userIdentity(author), displayBody }
  },
]
export const TaskMessageFollowers: CollectionConfig = {
  slug: 'task-message-followers',
  admin: hidden,
  access: {
    read: ({ req }) =>
      req.user
        ? {
            and: [
              { user: { equals: req.user.id } },
              ...(isAdministrator(req) ? [] : [boardWhere(req, 'read', 'thread.board.')]),
            ],
          }
        : false,
    create: signedIn,
    update: ({ req }) => (req.user ? { user: { equals: req.user.id } } : false),
    delete: never,
  },
  fields: [
    rel('thread', 'task-board-messages'),
    rel('user', 'users', false),
    { name: 'key', type: 'text', required: false, unique: true },
    { name: 'following', type: 'checkbox', defaultValue: true },
  ],
  hooks: {
    beforeChange: [
      async ({ req, data, originalDoc }) => {
        const id = data.thread ?? originalDoc?.thread
        const message = await req.payload.findByID({
          collection: 'task-board-messages',
          id: relationID(id),
          req,
          overrideAccess: false,
          depth: 0,
        })
        if (message.parent) reject('Follow the parent discussion.')
        if (originalDoc?.id && relationID(originalDoc.thread) !== relationID(id))
          reject('Followers cannot move.')
        return { ...data, user: req.user!.id, key: `${id}:${req.user!.id}` }
      },
    ],
  },
}
export const projectCollections = [
  TaskProjects,
  TaskProjectMemberships,
  TaskProjectPreferences,
  TaskViews,
  TaskBoardFields,
  TaskBoardPages,
  TaskBaselines,
  TaskFieldDefinitions,
  TaskFieldValues,
  TaskDependencies,
  TaskAttachments,
  TaskTimeEntries,
  TaskTimeAudit,
  TaskCountdowns,
  TaskCapacities,
  TaskBoardMessages,
  TaskMessageFollowers,
]
for (const collection of projectCollections) {
  collection.hooks ??= {}
  collection.hooks.beforeOperation = [directQueryOnly, ...(collection.hooks.beforeOperation ?? [])]
}
