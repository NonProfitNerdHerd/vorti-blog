import type { PayloadRequest } from 'payload'
import { relationID } from './documents'
import { requireTask, reject, workspaceDB, ensureWorkspaceGuards } from './workspace-access'
import { managesTime, timeSummary } from './workspace-time'

export async function mutateWorkTime(
  req: PayloadRequest,
  taskID: number,
  data: Record<string, any>,
): Promise<any> {
  const task = await requireTask(req, taskID, 'edit'),
    db = workspaceDB(req),
    user = req.user!.id
  if (!['start-time', 'stop-time', 'switch-time', 'save-time'].includes(data.action))
    reject('Unknown time action.', 400)
  if (
    data.operationKey !== undefined &&
    (typeof data.operationKey !== 'string' || !/^[\w-]{8,100}$/.test(data.operationKey))
  )
    reject('Invalid time operation key.', 400)
  const key = `${user}:${data.operationKey ?? crypto.randomUUID()}`
  const input = JSON.stringify([
    taskID,
    data.action,
    data.entry ?? null,
    data.expectedUpdatedAt ?? null,
    data.startedAt ?? null,
    data.endedAt ?? null,
    data.note ?? '',
    data.reason ?? '',
    data.field ?? null,
  ])
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('')
  const previousOperation = await db
    .prepare('SELECT fingerprint FROM task_time_audit WHERE operation_key=?')
    .bind(`${key}:0`)
    .first<{ fingerprint: string }>()
  if (previousOperation) {
    if (previousOperation.fingerprint !== fingerprint)
      reject('This operation key was already used for a different change.', 409)
    return timeSummary(req, taskID)
  }
  const now = new Date().toISOString(),
    guard = crypto.randomUUID(),
    statements: D1PreparedStatement[] = []
  await ensureWorkspaceGuards(req)
  const snapshot = (entry: any) =>
    entry
      ? JSON.stringify({
          id: entry.id,
          task: Number(relationID(entry.task)),
          startedAt: entry.startedAt,
          endedAt: entry.endedAt ?? null,
          seconds: entry.seconds ?? 0,
          note: entry.note ?? null,
          user: Number(relationID(entry.user)),
          field: entry.field ? Number(relationID(entry.field)) : null,
          activeUserKey: entry.activeUserKey ?? null,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          history: entry.history ?? [],
        })
      : null
  const audit = (
    id: number | null,
    owner: number,
    scope: number,
    action: string,
    before: any,
    suffix = 0,
  ) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO task_time_audit(task_id,entry_id,actor_id,entry_user_id,action,reason,before_value,after_value,operation_key,fingerprint,updated_at,created_at)
      SELECT ?,e.id,?,?,?, ?,?,json_object('id',e.id,'task',e.task_id,'startedAt',e.started_at,'endedAt',e.ended_at,'seconds',e.seconds,'note',e.note,'user',e.user_id,'field',e.field_id,'activeUserKey',e.active_user_key,'createdAt',e.created_at,'updatedAt',e.updated_at,'history',json(COALESCE(e.history,'[]'))),?,?,?,? FROM task_time_entries e WHERE e.id=${id === null ? 'last_insert_rowid()' : '?'}`,
        )
        .bind(
          ...[
            scope,
            user,
            owner,
            action,
            String(data.reason ?? (action === 'correct' ? 'Self edit' : action)).slice(0, 2000),
            snapshot(before),
            `${key}:${suffix}`,
            fingerprint,
            now,
            now,
            ...(id === null ? [] : [id]),
          ],
        ),
    )
  }
  const revision = (entry: any) =>
    statements.push(
      db
        .prepare(
          'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM task_time_entries WHERE id=? AND updated_at=? AND (active_user_key=? OR (active_user_key IS NULL AND ? IS NULL))) THEN 1 ELSE 0 END)',
        )
        .bind(
          guard,
          entry.id,
          entry.updatedAt,
          entry.activeUserKey ?? null,
          entry.activeUserKey ?? null,
        ),
    )
  const active = await req.payload.find({
    collection: 'task-time-entries',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { activeUserKey: { equals: String(user) } },
  })
  if (data.action === 'start-time' || data.action === 'switch-time') {
    if (data.field) {
      const { taskFields } = await import('./workspace-fields')
      if (
        !(await taskFields(req, taskID)).some(
          (item) => item.definition.id === data.field && item.definition.kind === 'time-tracking',
        )
      )
        reject('Time tracking field is unavailable.', 400)
    }
    if (active.docs[0]) {
      const entry = active.docs[0]
      if (data.action !== 'switch-time' || entry.updatedAt !== data.expectedUpdatedAt)
        reject('You already have a running stopwatch. Stop it or explicitly switch tasks.', 409)
      revision(entry)
      statements.push(
        db
          .prepare(
            'UPDATE task_time_entries SET ended_at=?,seconds=?,active_user_key=NULL,updated_at=? WHERE id=?',
          )
          .bind(
            now,
            Math.max(0, Math.floor((Date.parse(now) - Date.parse(entry.startedAt)) / 1000)),
            now,
            entry.id,
          ),
      )
      audit(entry.id, user, Number(relationID(entry.task)), 'switch-stop', entry)
    } else if (data.action === 'switch-time') reject('The running stopwatch changed. Reload.', 409)
    statements.push(
      db
        .prepare(
          'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM task_time_entries WHERE user_id=? AND (ended_at>? OR ended_at IS NULL)) THEN 1 ELSE 0 END)',
        )
        .bind(`${guard}:overlap`, user, now),
      db
        .prepare(
          'INSERT INTO task_time_entries(task_id,user_id,field_id,started_at,seconds,active_user_key,history,updated_at,created_at) VALUES(?,?,?,?,0,?,?,?,?)',
        )
        .bind(taskID, user, data.field ?? null, now, String(user), '[]', now, now),
    )
    audit(null, user, taskID, 'start', null, active.docs[0] ? 1 : 0)
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
        original.updatedAt !== data.expectedUpdatedAt)
    )
      reject('The entry changed. Reload before saving.', 409)
    if (data.action === 'stop-time') {
      if (!original || relationID(original.user) !== String(user) || !original.activeUserKey)
        reject('The running timer is unavailable.', 409)
      revision(original)
      statements.push(
        db
          .prepare(
            'UPDATE task_time_entries SET ended_at=?,seconds=?,active_user_key=NULL,updated_at=? WHERE id=?',
          )
          .bind(
            now,
            Math.max(0, Math.floor((Date.parse(now) - Date.parse(original.startedAt)) / 1000)),
            now,
            original.id,
          ),
      )
      audit(original.id, user, taskID, 'pause', original)
    } else {
      if (original?.activeUserKey) reject('Pause the timer before editing its entry.', 409)
      const owner = original ? Number(relationID(original.user)) : user
      if (
        owner !== user &&
        (!(await managesTime(req, task)) || typeof data.reason !== 'string' || !data.reason.trim())
      )
        reject('Manager corrections require permission and an audit reason.')
      const start = Date.parse(data.startedAt),
        end = Date.parse(data.endedAt)
      if (
        [data.startedAt, data.endedAt].some(
          (value) =>
            typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value),
        ) ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end - start < 1000 ||
        end > Date.now() + 60000
      )
        reject('Enter a valid completed time interval with timezone offsets.', 400)
      const from = new Date(start).toISOString(),
        to = new Date(end).toISOString(),
        note = String(data.note ?? '').slice(0, 2000),
        seconds = Math.floor((end - start) / 1000)
      statements.push(
        db
          .prepare(
            'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM task_time_entries WHERE user_id=? AND id!=? AND started_at<? AND (ended_at>? OR ended_at IS NULL)) THEN 1 ELSE 0 END)',
          )
          .bind(`${guard}:overlap`, owner, original?.id ?? -1, to, from),
      )
      if (original) {
        revision(original)
        statements.push(
          db
            .prepare(
              'UPDATE task_time_entries SET started_at=?,ended_at=?,seconds=?,note=?,updated_at=? WHERE id=?',
            )
            .bind(from, to, seconds, note, now, original.id),
        )
      } else
        statements.push(
          db
            .prepare(
              'INSERT INTO task_time_entries(task_id,user_id,started_at,ended_at,seconds,note,history,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .bind(taskID, owner, from, to, seconds, note, '[]', now, now),
        )
      audit(original?.id ?? null, owner, taskID, original ? 'correct' : 'manual', original)
    }
  }
  statements.push(
    db
      .prepare('DELETE FROM task_workspace_guards WHERE id=? OR id=?')
      .bind(guard, `${guard}:overlap`),
  )
  try {
    await db.batch(statements)
  } catch {
    const replay = await db
      .prepare('SELECT fingerprint FROM task_time_audit WHERE operation_key=?')
      .bind(`${key}:0`)
      .first<{ fingerprint: string }>()
    if (replay?.fingerprint === fingerprint) return timeSummary(req, taskID)
    reject(
      'The entry changed, overlaps another session, or another timer is running. Reload before retrying.',
      409,
    )
  }
  return timeSummary(req, taskID)
}
