import type { PayloadRequest, Where } from 'payload'
import { isAdministrator, relationID } from './documents'
import {
  boardRole,
  reject,
  requireTask,
  workspaceDB,
  ensureWorkspaceGuards,
} from './workspace-access'
import { projectRole } from './project-access'
import { siteWeek } from './workspace-dates'

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
  } = {},
) {
  const task = options.task ?? (await requireTask(req, taskID))
  const totals = await workspaceDB(req)
    .prepare(
      'SELECT coalesce(sum(seconds),0) AS seconds FROM task_time_entries WHERE task_id=? AND ended_at IS NOT NULL',
    )
    .bind(taskID)
    .first<{ seconds: number }>()
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
    limit: 100,
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
        limit: 100,
        page,
        sort: '-startedAt',
        where,
      })
      docs.push(...more.docs)
    }
  const active = await req.payload.find({
    collection: 'task-time-entries',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { activeUserKey: { equals: String(req.user!.id) } },
  })
  return {
    seconds: totals?.seconds ?? 0,
    entries: docs,
    timezone,
    activeTimer: active.docs[0]
      ? { id: active.docs[0].id, updatedAt: active.docs[0].updatedAt }
      : null,
    manager,
    totalEntries: entries.totalDocs,
    totalPages: entries.totalPages,
    page: entries.page,
  }
}
export async function mutateTime(req: PayloadRequest, taskID: number, data: Record<string, any>) {
  const task = await requireTask(req, taskID)
  if (!req.user) reject('Sign in.', 401)
  await requireTask(req, taskID, 'edit')
  const db = workspaceDB(req),
    now = new Date().toISOString(),
    user = req.user!.id
  if (data.action === 'start-time') {
    await requireTask(req, taskID, 'edit')
    const active = await db
      .prepare('SELECT id,task_id FROM task_time_entries WHERE active_user_key=?')
      .bind(String(user))
      .first<{ id: number; task_id: number }>()
    if (active)
      reject('You already have a running stopwatch. Stop it or explicitly switch tasks.', 409)
    try {
      await db
        .prepare(
          'INSERT INTO task_time_entries(task_id,user_id,field_id,started_at,seconds,active_user_key,history,updated_at,created_at) VALUES(?,?,?,?,0,?,?,?,?)',
        )
        .bind(taskID, user, data.field ?? null, now, String(user), '[]', now, now)
        .run()
    } catch {
      reject('A stopwatch was started elsewhere. Reload before retrying.', 409)
    }
  } else if (data.action === 'switch-time') {
    await requireTask(req, taskID, 'edit')
    const active = await req.payload.find({
      collection: 'task-time-entries',
      req,
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { activeUserKey: { equals: String(user) } },
    })
    const previous = active.docs[0]
    if (!previous || previous.updatedAt !== data.expectedUpdatedAt)
      reject('The running stopwatch changed. Reload.', 409)
    // Explicit switch can stop the user’s own revoked-access timer without revealing its task.
    const elapsed = Math.max(
      0,
      Math.floor((Date.parse(now) - Date.parse(previous.startedAt)) / 1000),
    )
    await ensureWorkspaceGuards(req)
    const guard = crypto.randomUUID()
    await db.batch([
      db
        .prepare(
          'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM task_time_entries WHERE id=? AND updated_at=? AND active_user_key=?) THEN 1 ELSE 0 END)',
        )
        .bind(guard, previous.id, previous.updatedAt, String(user)),
      db
        .prepare(
          'UPDATE task_time_entries SET ended_at=?,seconds=?,active_user_key=NULL,updated_at=? WHERE id=?',
        )
        .bind(now, elapsed, now, previous.id),
      db
        .prepare(
          'INSERT INTO task_time_entries(task_id,user_id,started_at,seconds,active_user_key,history,updated_at,created_at) VALUES(?,?,?,0,?,?,?,?)',
        )
        .bind(taskID, user, now, String(user), '[]', now, now),
      db.prepare('DELETE FROM task_workspace_guards WHERE id=?').bind(guard),
    ])
  } else if (data.action === 'stop-time') {
    const entry = await req.payload.findByID({
      collection: 'task-time-entries',
      id: data.entry,
      req,
      overrideAccess: true,
      depth: 0,
    })
    if (
      relationID(entry.user) !== String(user) ||
      relationID(entry.task) !== String(taskID) ||
      !entry.activeUserKey ||
      entry.updatedAt !== data.expectedUpdatedAt
    )
      reject('The running timer changed or is unavailable.', 409)
    const seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(entry.startedAt)) / 1000))
    const result = await db
      .prepare(
        'UPDATE task_time_entries SET ended_at=?,seconds=?,active_user_key=NULL,updated_at=? WHERE id=? AND updated_at=? AND active_user_key=?',
      )
      .bind(now, seconds, now, entry.id, entry.updatedAt, String(user))
      .run()
    if (!result.meta.changes) reject('The timer changed. Reload.', 409)
  } else {
    const original = data.entry
      ? await req.payload.findByID({
          collection: 'task-time-entries',
          id: data.entry,
          req,
          overrideAccess: true,
          depth: 0,
        })
      : null
    if (
      original &&
      (relationID(original.task) !== String(taskID) ||
        original.updatedAt !== data.expectedUpdatedAt ||
        original.activeUserKey)
    )
      reject('Reload or stop the timer before editing this entry.', 409)
    const target = original ? Number(relationID(original.user)) : user
    if (
      target !== user &&
      (!(await managesTime(req, task)) || typeof data.reason !== 'string' || !data.reason.trim())
    )
      reject('Manager corrections require permission and an audit reason.')
    const start = Date.parse(data.startedAt),
      end = Date.parse(data.endedAt)
    if (
      [data.startedAt, data.endedAt].some(
        (value) =>
          typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value),
      )
    )
      reject('Time entries require timestamps with an explicit timezone offset.', 400)
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end - start < 1000 ||
      end > Date.now() + 60000
    )
      reject('Enter a valid completed time interval.', 400)
    const overlap = await req.payload.count({
      collection: 'task-time-entries',
      req,
      overrideAccess: true,
      where: {
        and: [
          { user: { equals: target } },
          ...(original ? [{ id: { not_equals: original.id } }] : []),
          { startedAt: { less_than: new Date(end).toISOString() } },
          {
            or: [
              { endedAt: { greater_than: new Date(start).toISOString() } },
              { endedAt: { exists: false } },
            ],
          },
        ],
      },
    })
    if (overlap.totalDocs) reject('This entry overlaps another recorded session.', 409)
    const history = Array.isArray(original?.history) ? original.history : []
    const audit = JSON.stringify([
      ...history,
      {
        actor: user,
        at: now,
        reason: String(data.reason ?? 'Self edit'),
        previous: original
          ? { startedAt: original.startedAt, endedAt: original.endedAt, note: original.note }
          : null,
      },
    ])
    const guard = crypto.randomUUID(),
      from = new Date(start).toISOString(),
      to = new Date(end).toISOString(),
      note = String(data.note ?? '').slice(0, 2000)
    await ensureWorkspaceGuards(req)
    const statements = [
      db
        .prepare(
          'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM task_time_entries WHERE user_id=? AND id!=? AND started_at<? AND (ended_at>? OR ended_at IS NULL)) THEN 1 ELSE 0 END)',
        )
        .bind(guard, target, original?.id ?? -1, to, from),
    ]
    if (original) {
      statements.push(
        db
          .prepare(
            'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM task_time_entries WHERE id=? AND updated_at=? AND active_user_key IS NULL) THEN 1 ELSE 0 END)',
          )
          .bind(`${guard}:revision`, original.id, original.updatedAt),
        db
          .prepare(
            'UPDATE task_time_entries SET started_at=?,ended_at=?,seconds=?,note=?,history=?,updated_at=? WHERE id=?',
          )
          .bind(from, to, Math.floor((end - start) / 1000), note, audit, now, original.id),
      )
    } else
      statements.push(
        db
          .prepare(
            'INSERT INTO task_time_entries(task_id,user_id,started_at,ended_at,seconds,note,history,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(taskID, target, from, to, Math.floor((end - start) / 1000), note, audit, now, now),
      )
    statements.push(
      db
        .prepare('DELETE FROM task_workspace_guards WHERE id=? OR id=?')
        .bind(guard, `${guard}:revision`),
    )
    try {
      await db.batch(statements)
    } catch {
      reject('The entry changed or overlaps another session. Reload before saving.', 409)
    }
  }
  return timeSummary(req, taskID)
}
