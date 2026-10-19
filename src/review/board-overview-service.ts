import type { PayloadRequest, Where } from 'payload'
import { userIdentity } from '@design-system/payload-design-core'
import { relationID } from './documents'
import { boardRole, reject, requireBoard } from './workspace-access'

export async function boardPeople(req: PayloadRequest, board: string) {
  await requireBoard(req, board)
  const users = await req.payload.find({
    collection: 'users',
    req,
    overrideAccess: true,
    depth: 1,
    pagination: false,
  })
  const docs = []
  for (const user of users.docs) {
    const role = await boardRole({ ...req, user } as PayloadRequest, board)
    if (role)
      docs.push({
        id: user.id,
        label: userIdentity(user),
        username: user.username || null,
        role,
        avatar: typeof user.profilePhoto === 'object' ? user.profilePhoto?.url : null,
      })
  }
  return { docs }
}

type Source = 'board' | 'task' | 'comment' | 'file'
type Cursor = { date: string; source: Source; id: number }
export type BoardActivityItem = {
  id: number
  source: Source
  createdAt: string
  message: string
  actor: string
  task?: number
  comment?: number
  attachment?: number
  title?: string
}
const sources = ['board', 'comment', 'file', 'task'] as const
export async function boardActivity(req: PayloadRequest, board: string, params: URLSearchParams) {
  await requireBoard(req, board)
  const limit = Number(params.get('limit') ?? 50)
  if (![10, 25, 50, 100, 200].includes(limit)) reject('Choose a supported row count.', 400)
  let cursor: Cursor | undefined
  try {
    if (params.get('cursor')) {
      cursor = JSON.parse(params.get('cursor')!)
      if (
        !cursor ||
        !sources.includes(cursor.source) ||
        !Number.isSafeInteger(cursor.id) ||
        cursor.id < 1 ||
        !/^\d{4}-\d\d-\d\dT/.test(cursor.date) ||
        !Number.isFinite(Date.parse(cursor.date))
      )
        throw Error()
    }
  } catch {
    reject('Invalid activity position. Refresh the activity table.', 400)
  }
  // Read access to this board grants read access to its attached tasks. Scope the query
  // to that exact relationship instead of duplicating the full task ACL joins (D1 has
  // a 64-table join limit). No accessible-ID list or client-supplied permission is used.
  const taskScope: Where = { 'task.boards': { equals: board } }
  const definitions = [
    {
      source: 'board' as const,
      collection: 'task-board-activity' as const,
      where: { board: { equals: board } } as Where,
    },
    { source: 'task' as const, collection: 'review-activity' as const, where: taskScope },
    {
      source: 'comment' as const,
      collection: 'review-comments' as const,
      where: { and: [taskScope, { moderated: { not_equals: true } }] } as Where,
    },
    {
      source: 'file' as const,
      collection: 'task-attachments' as const,
      where: {
        and: [
          { state: { equals: 'ready' } },
          { or: [{ comment: { exists: false } }, { 'comment.moderated': { not_equals: true } }] },
          { or: [taskScope, { and: [{ board: { equals: board } }, { task: { exists: false } }] }] },
        ],
      } as Where,
    },
  ]
  const rows: BoardActivityItem[] = []
  const actors = new Map<string, unknown>()
  let totalDocs = 0
  const labels = new Map<string, string>()
  async function actorLabel(id: unknown) {
    const key = relationID(id)
    if (!key) return 'System'
    if (!labels.has(key)) {
      try {
        const user = await req.payload.findByID({
          collection: 'users',
          id: key,
          req,
          overrideAccess: true,
          depth: 0,
        })
        labels.set(key, userIdentity(user))
      } catch {
        labels.set(key, 'Former user')
      }
    }
    return labels.get(key)!
  }
  for (const definition of definitions) {
    const { source, collection, where } = definition
    // requireBoard above authorizes this exact board scope, including private file metadata.
    const overrideAccess = true
    totalDocs += (await req.payload.count({ collection, req, overrideAccess, where })).totalDocs
    let after: Where = {}
    if (cursor) {
      const sameDay: Where = { createdAt: { equals: cursor.date } }
      after = {
        or: [
          { createdAt: { less_than: cursor.date } },
          ...(source > cursor.source
            ? [sameDay]
            : source === cursor.source
              ? [{ and: [sameDay, { id: { less_than: cursor.id } }] }]
              : []),
        ],
      }
    }
    const result = await req.payload.find({
      collection,
      req,
      overrideAccess,
      depth: 0,
      limit: limit + 1,
      where: { and: [where, after] },
      sort: ['-createdAt', '-id'],
    })
    for (const doc of result.docs as any[]) {
      const task = relationID(doc.task)
      const row: BoardActivityItem = {
        id: doc.id,
        source,
        createdAt: doc.createdAt,
        message:
          source === 'comment'
            ? 'Comment added'
            : source === 'file'
              ? `Attachment added: ${doc.filename}`
              : doc.message,
        actor: '',
        ...(task ? { task: Number(task) } : {}),
        ...(source === 'comment' ? { comment: doc.id } : {}),
        ...(source === 'file' ? { attachment: doc.id } : {}),
      }
      actors.set(`${source}:${doc.id}`, doc.actor ?? doc.author ?? doc.uploader)
      rows.push(row)
    }
  }
  rows.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.source.localeCompare(b.source) || b.id - a.id,
  )
  const docs = rows.slice(0, limit),
    last = docs.at(-1)
  const titles = new Map<number, string | undefined>()
  for (const row of docs) {
    row.actor = await actorLabel(actors.get(`${row.source}:${row.id}`))
    const match =
      row.source === 'board'
        ? /^Task #(\d+) (?:added to board|removed from board|moved)$/.exec(row.message)
        : null
    const targetID = row.task ?? (match ? Number(match[1]) : undefined)
    if (targetID) {
      if (!titles.has(targetID)) {
        // Board access already authorizes the attached task. Recheck exact membership,
        // return only its title, and hydrate only this page rather than all merge candidates.
        const target = await req.payload.find({
          collection: 'review-tasks',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 1,
          select: { title: true },
          where: { and: [{ id: { equals: targetID } }, { boards: { equals: board } }] },
        })
        titles.set(targetID, target.docs[0]?.title)
      }
      if (titles.get(targetID)) {
        row.task = targetID
        row.title = titles.get(targetID)
      } else {
        delete row.task
        delete row.comment
        delete row.attachment
        row.title = 'Unavailable item'
      }
    }
  }
  await requireBoard(req, board)
  return {
    docs,
    totalDocs,
    nextCursor:
      rows.length > limit && last
        ? JSON.stringify({ date: last.createdAt, source: last.source, id: last.id })
        : null,
  }
}
