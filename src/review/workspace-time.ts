import type { PayloadRequest, Where } from 'payload'
import { isAdministrator, relationID } from './documents'
import { boardRole, requireTask, workspaceDB, canTask } from './workspace-access'
import { projectRole } from './project-access'
import { siteWeek } from './workspace-dates'
import { userIdentity } from '@design-system/payload-design-core'

export async function workTotal(req: PayloadRequest, taskID: number) {
  return (
    (
      await workspaceDB(req)
        .prepare(
          'SELECT coalesce(sum(CASE WHEN ended_at IS NOT NULL THEN seconds ELSE max(0,cast((julianday(?) - julianday(started_at))*86400 AS INTEGER)) END),0) AS seconds FROM task_time_entries WHERE task_id=?',
        )
        .bind(new Date().toISOString(), taskID)
        .first<{ seconds: number }>()
    )?.seconds ?? 0
  )
}
export async function activeWork(req: PayloadRequest) {
  const entry = (
    await req.payload.find({
      collection: 'task-time-entries',
      req,
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { activeUserKey: { equals: String(req.user!.id) } },
    })
  ).docs[0]
  return entry
    ? {
        id: entry.id,
        updatedAt: entry.updatedAt,
        startedAt: entry.startedAt,
        ...((await canTask(req, entry.task)) ? { task: Number(relationID(entry.task)) } : {}),
      }
    : null
}
export async function timeAudit(req: PayloadRequest, taskID: number, page = 1, limit = 50) {
  const task = await requireTask(req, taskID),
    manager = await managesTime(req, task)
  const result = await req.payload.find({
    collection: 'task-time-audit',
    req,
    overrideAccess: true,
    depth: 0,
    limit,
    page,
    sort: '-createdAt',
    where: {
      and: [
        { task: { equals: taskID } },
        ...(manager ? [] : [{ entryUser: { equals: req.user!.id } }]),
      ],
    },
  })
  const docs = []
  for (const row of result.docs) {
    const actor = await req.payload
      .findByID({
        collection: 'users',
        id: relationID(row.actor),
        req,
        overrideAccess: true,
        depth: 0,
      })
      .catch((): null => null)
    const { operationKey: _key, fingerprint: _fingerprint, ...visible } = row
    docs.push({ ...visible, actorLabel: actor ? userIdentity(actor) : 'Former user' })
  }
  const db = workspaceDB(req),
    condition =
      'task_id=? AND json_valid(history) AND json_array_length(history)>0 AND (?=1 OR user_id=?)'
  const count = await db
    .prepare(`SELECT count(*) total FROM task_time_entries WHERE ${condition}`)
    .bind(taskID, manager ? 1 : 0, req.user!.id)
    .first<{ total: number }>()
  const old = await db
    .prepare(
      `SELECT history FROM task_time_entries WHERE ${condition} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    )
    .bind(taskID, manager ? 1 : 0, req.user!.id, limit, (page - 1) * limit)
    .all<{ history: string }>()
  const legacy = []
  for (const entry of old.results)
    for (const row of JSON.parse(entry.history)) {
      const actor = row.actor
        ? await req.payload
            .findByID({ collection: 'users', id: row.actor, req, overrideAccess: true, depth: 0 })
            .catch((): null => null)
        : null
      legacy.push({ ...row, actorLabel: actor ? userIdentity(actor) : 'Not recorded' })
    }
  return {
    ...result,
    docs,
    legacy: { docs: legacy, totalPages: Math.ceil((count?.total ?? 0) / limit) },
  }
}

export async function managesTime(req: PayloadRequest, task: { boards?: unknown[] | null }) {
  if (isAdministrator(req)) return true
  for (const id of task.boards ?? []) {
    if ((await boardRole(req, id)) === 'owner') return true
    const board = await req.payload.findByID({
      collection: 'task-boards',
      id: relationID(id),
      req,
      overrideAccess: true,
      depth: 0,
    })
    // Private-board exceptions are not exposed to project owners without board access.
    if (
      (await boardRole(req, id)) &&
      board.project &&
      (await projectRole(req, board.project)) === 'owner'
    )
      return true
  }
  return false
}
export async function timeSummary(
  req: PayloadRequest,
  taskID: number,
  all = false,
  options: {
    task?: { boards?: unknown[] | null }
    timezone?: string
    totalsOnly?: boolean
    week?: string
    page?: number
    limit?: number
  } = {},
): Promise<any> {
  const task = options.task ?? (await requireTask(req, taskID))
  const totals = { seconds: await workTotal(req, taskID) }
  if (options.totalsOnly)
    return {
      seconds: totals?.seconds ?? 0,
      entries: [],
      manager: false,
      totalEntries: 0,
      totalPages: 0,
      page: 1,
      timezone: options.timezone ?? 'UTC',
      activeTimer: null,
    }
  const manager = await managesTime(req, task)
  const settings = options.timezone
      ? null
      : await req.payload.findGlobal({
          slug: 'site-settings',
          req,
          overrideAccess: true,
          depth: 0,
        }),
    timezone = options.timezone ?? settings?.timezone ?? 'UTC',
    range = options.week ? siteWeek(options.week, timezone) : null
  const where: Where = {
    and: [
      { task: { equals: taskID } },
      ...(manager ? [] : [{ user: { equals: req.user!.id } }]),
      ...(range
        ? [
            { startedAt: { less_than: new Date(range.end).toISOString() } },
            {
              or: [
                { endedAt: { greater_than: new Date(range.start).toISOString() } },
                { endedAt: { exists: false } },
              ],
            },
          ]
        : []),
    ],
  }
  const entries = await req.payload.find({
    collection: 'task-time-entries',
    req,
    overrideAccess: true,
    depth: 0,
    limit: options.limit ?? 100,
    page: Math.max(1, options.page ?? 1),
    sort: '-startedAt',
    where,
  })
  const docs = [...entries.docs]
  if (all)
    for (let page = 2; page <= entries.totalPages; page++) {
      const more = await req.payload.find({
        collection: 'task-time-entries',
        req,
        overrideAccess: true,
        depth: 0,
        limit: options.limit ?? 100,
        page,
        sort: '-startedAt',
        where,
      })
      docs.push(...more.docs)
    }
  const active = await activeWork(req),
    editable = await canTask(req, taskID, 'edit')
  const enriched = []
  for (const entry of docs) {
    const person = entry.user
      ? await req.payload
          .findByID({
            collection: 'users',
            id: relationID(entry.user),
            req,
            overrideAccess: true,
            depth: 0,
          })
          .catch((): null => null)
      : null
    enriched.push({
      ...entry,
      userLabel: person ? userIdentity(person) : 'Former user',
      canEdit:
        editable &&
        !entry.activeUserKey &&
        (relationID(entry.user) === String(req.user!.id) || manager),
    })
  }
  return {
    seconds: totals?.seconds ?? 0,
    entries: enriched,
    asOf: new Date().toISOString(),
    timezone,
    activeTimer: active,
    manager,
    totalEntries: entries.totalDocs,
    totalPages: entries.totalPages,
    page: entries.page,
  }
}
export { mutateWorkTime as mutateTime } from './time-mutations'
