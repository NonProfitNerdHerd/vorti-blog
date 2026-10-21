import { workspaceReq } from './workspace-access'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { relationID } from './documents'
import { internalWorkspace, reject } from './workspace-access'
import { notify } from './workspace-collections'
import { cmsDatabase, cmsSiteContext } from '../organizations/cms-scope'

type Delivery = { recipient: string; kind: 'mention' | 'assignment' | 'comment' | 'invitation' | 'approval'; board?: string; request?: string; project?: string; thread?: string; projectChange?: string }
type EventDocument = {
  id: number
  updatedAt: string
  creator?: unknown
  assignee?: unknown
  mentions?: unknown
  task?: unknown
  moderated?: boolean
}
export const TaskNotificationEvents: CollectionConfig = {
  slug: 'task-notification-events',
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'key', type: 'text', unique: true, required: true },
    { name: 'task', type: 'relationship', relationTo: 'review-tasks' },
    { name: 'actor', type: 'relationship', relationTo: 'users' },
    { name: 'comment', type: 'relationship', relationTo: 'review-comments' },
    { name: 'deliveries', type: 'json', required: true },
    { name: 'delivered', type: 'checkbox', defaultValue: false, index: true },
    { name: 'attempts', type: 'number', defaultValue: 0 },
  ],
  hooks: {
    beforeChange: [
      ({ req }) => {
        if (!internalWorkspace(req)) reject('Notification events are server-generated.')
      },
    ],
  },
}

export async function followAutomatically(req: PayloadRequest, task: number, user: unknown) {
  if (!user) return
  const key = `${task}:${relationID(user)}`
  const found = await req.payload.count({
    collection: 'task-followers',
    req,
    overrideAccess: true,
    where: { key: { equals: key } },
  })
  if (!found.totalDocs)
    await req.payload.create({
      collection: 'task-followers',
      req: workspaceReq(req),
      overrideAccess: true,
      data: { task, user: Number(relationID(user)), key, following: true, muted: false },
    })
}

export async function queueTaskEvent(
  req: PayloadRequest,
  task: number,
  key: string,
  deliveries: Delivery[],
  comment?: number,
) {
  // Mention wins over assignment, which wins over a followed comment for the same save.
  const unique = [
    ...new Map(
      deliveries.filter((d) => d.recipient !== String(req.user?.id)).map((d) => [d.recipient, d]),
    ).values(),
  ]
  if (!unique.length) return
  const existing = await req.payload.find({
    collection: 'task-notification-events',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { key: { equals: key } },
  })
  if (!existing.docs[0])
    await req.payload.create({
      collection: 'task-notification-events',
      req: workspaceReq(req),
      overrideAccess: true,
      data: { key, task, actor: req.user?.id, comment, deliveries: unique },
    })
  await drainNotifications(req)
}

export async function drainNotifications(req: PayloadRequest) {
  const pending = await req.payload.find({
    collection: 'task-notification-events',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 5,
    where: { delivered: { not_equals: true } },
    sort: 'createdAt',
  })
  for (const event of pending.docs) {
    try {
      const actors = event.actor
        ? await req.payload.find({
            collection: 'users',
            // Stored event actor only; this is not a directory/search response.
            overrideAccess: true,
            depth: 0,
            limit: 1,
            where: { id: { equals: relationID(event.actor) } },
          })
        : null
      const actor = actors?.docs[0] ?? null
      const eventReq = {
        ...req,
        user: actor ? { ...actor, collection: 'users' } : null,
      } as PayloadRequest
      const deliveries = event.deliveries as Delivery[]
      for (const delivery of deliveries.slice(0, 10)) {
        // A worker's current UI context must not retarget a durable event. Resolve its source,
        // then notify rechecks the recipient's current access before creating any inbox item.
        const source = event.task
          ? await cmsDatabase(req).prepare(`SELECT COALESCE((SELECT b.platform_site FROM review_tasks_rels r JOIN task_boards b ON b.id=r.task_boards_id WHERE r.parent_id=t.id AND r.path='boards' AND b.platform_site IS NOT NULL ORDER BY b.id LIMIT 1),t.document_site,'default') AS site FROM review_tasks t WHERE t.id=?`).bind(relationID(event.task)).first<{ site: string }>()
          : delivery.board
            ? await cmsDatabase(req).prepare("SELECT COALESCE(platform_site,'default') AS site FROM task_boards WHERE id=?").bind(delivery.board).first<{ site: string }>()
            : delivery.project
              ? await cmsDatabase(req).prepare("SELECT COALESCE(platform_site,'default') AS site FROM task_projects WHERE id=?").bind(delivery.project).first<{ site: string }>()
              : { site: 'default' }
        if (!source) continue
        await notify({ ...eventReq, context: { ...eventReq.context, ...cmsSiteContext(source.site) } }, {
          ...delivery,
          task: event.task ? relationID(event.task) : undefined,
          comment: event.comment ? relationID(event.comment) : undefined,
          key: event.key,
          message:
            delivery.kind === 'mention'
              ? 'You were mentioned in a task.'
              : delivery.kind === 'assignment'
                ? 'A task was assigned to you.'
                : delivery.kind === 'invitation' ? `You were added to a ${delivery.project ? 'project' : 'board'}.` : delivery.kind === 'approval' ? 'A sharing change needs your approval.' : delivery.thread ? 'New board discussion activity.' : 'New comment on a task you follow.',
        })
      }
      await req.payload.update({
        collection: 'task-notification-events',
        id: event.id,
        req: workspaceReq(req),
        overrideAccess: true,
        data: {
          delivered: deliveries.length <= 10,
          deliveries: deliveries.slice(10),
          attempts: (event.attempts ?? 0) + 1,
        },
      })
    } catch (error) {
      req.payload.logger.error({
        msg: 'Task notification delivery will be retried',
        event: event.id,
        error: String(error),
      })
      await req.payload.update({
        collection: 'task-notification-events',
        id: event.id,
        req: workspaceReq(req),
        overrideAccess: true,
        data: { attempts: (event.attempts ?? 0) + 1 },
      })
    }
  }
}

export async function queueBoardEvent(req: PayloadRequest, event: { recipient: string; board?: string; task?: string; request?: string; project?: string; thread?: string; projectChange?: string; kind: 'invitation' | 'approval' | 'mention' | 'comment'; key: string }) {
  if (event.recipient === String(req.user?.id)) return
  const key = `${event.key}:${event.recipient}`
  const found = await req.payload.count({ collection: 'task-notification-events', req, overrideAccess: true, where: { key: { equals: key } } })
  if (!found.totalDocs) await req.payload.create({ collection: 'task-notification-events', req: workspaceReq(req), overrideAccess: true,
    data: { key, task: event.task ? Number(event.task) : undefined, actor: req.user?.id, deliveries: [{ recipient: event.recipient, board: event.board, request: event.request, project:event.project,thread:event.thread,projectChange:event.projectChange,kind: event.kind }] } })
  await drainNotifications(req)
}

export async function taskEvent(
  req: PayloadRequest,
  doc: EventDocument,
  previous: EventDocument | undefined,
  operation: string,
) {
  if (operation === 'create') await followAutomatically(req, doc.id, doc.creator)
  const deliveries: Delivery[] = []
  if (doc.assignee && relationID(doc.assignee) !== relationID(previous?.assignee)) {
    await followAutomatically(req, doc.id, doc.assignee)
    deliveries.push({ recipient: relationID(doc.assignee), kind: 'assignment' })
  }
  const old = new Set(
    (Array.isArray(previous?.mentions) ? previous.mentions : []).map((m: { user: number }) =>
      String(m.user),
    ),
  )
  for (const mention of Array.isArray(doc.mentions) ? doc.mentions : [])
    if (!old.has(String(mention.user)))
      deliveries.push({ recipient: String(mention.user), kind: 'mention' })
  await queueTaskEvent(req, doc.id, `task:${doc.id}:${doc.updatedAt}`, deliveries)
}

export async function commentEvent(
  req: PayloadRequest,
  doc: EventDocument,
  previous: EventDocument | undefined,
  operation: string,
) {
  if (doc.moderated) return
  const deliveries: Delivery[] = []
  if (operation === 'create') {
    const followers = await req.payload.find({
      collection: 'task-followers',
      req,
      overrideAccess: true,
      pagination: false,
      depth: 0,
      where: {
        and: [
          { task: { equals: relationID(doc.task) } },
          { following: { equals: true } },
          { muted: { not_equals: true } },
        ],
      },
    })
    for (const follower of followers.docs)
      deliveries.push({ recipient: relationID(follower.user), kind: 'comment' })
  }
  const old = new Set(
    (Array.isArray(previous?.mentions) ? previous.mentions : []).map((m: { user: number }) =>
      String(m.user),
    ),
  )
  for (const mention of Array.isArray(doc.mentions) ? doc.mentions : [])
    if (!old.has(String(mention.user)))
      deliveries.push({ recipient: String(mention.user), kind: 'mention' })
  await queueTaskEvent(
    req,
    Number(relationID(doc.task)),
    `comment:${doc.id}:${doc.updatedAt}`,
    deliveries,
    doc.id,
  )
}
