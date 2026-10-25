import { workspaceReq } from './workspace-access'
import { mutationFence } from '../organizations/mutation-guards'
import { workspaceMutationFence } from './workspace-commit'
import type { Endpoint, PayloadRequest } from 'payload'
import { relationID, isAdministrator } from './documents'
import { ids, reject, requireBoard, requireTask, workspaceDB } from './workspace-access'
import { boardAudit } from './workspace-collections'
import { queueBoardEvent } from './notifications'
import {
  workspaceAuthority,
  workspaceAuthorityCheck,
  type WorkspaceAuthority,
} from '../organizations/workspace-authority'

async function audience(
  req: PayloadRequest,
  task: {
    boards?: unknown
    creator?: unknown
    personal?: boolean | null
    documentType?: string | null
  },
  destination: string,
) {
  const boards = [...new Set([...ids(task.boards), destination])].sort()
  const owners = new Set<string>()
  if (
    !ids(task.boards).length &&
    (task.personal || !task.documentType || task.documentType === 'none') &&
    task.creator
  )
    owners.add(relationID(task.creator))
  const snapshot: unknown[] = []
  const sites = new Set<string>()
  for (const id of boards) {
    const board = await req.payload.findByID({
      collection: 'task-boards',
      id,
      req: workspaceReq(req),
      depth: 0,
      overrideAccess: true,
    })
    sites.add(board.platformSite || '')
    if (sites.size > 1) reject('Tasks cannot be shared between separate site audiences.')
    if (board.archived) reject('Restore archived boards before sharing tasks.', 400)
    if (ids(task.boards).includes(id)) owners.add(relationID(board.owner))
    const members = await req.payload.find({
      collection: 'task-board-memberships',
      req: workspaceReq(req),
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { board: { equals: id } },
      sort: 'id',
    })
    let projectSnapshot: unknown = null
    if (board.project) {
      const project = await req.payload.findByID({
        collection: 'task-projects',
        id: relationID(board.project),
        req: workspaceReq(req),
        depth: 0,
        overrideAccess: true,
      })
      if (project.archived) reject('Restore the project before sharing tasks.', 400)
      if (board.inheritProject && ids(task.boards).includes(id))
        owners.add(relationID(project.owner))
      const grants = await req.payload.find({
        collection: 'task-project-memberships',
        req: workspaceReq(req),
        depth: 0,
        overrideAccess: true,
        pagination: false,
        where: { project: { equals: project.id } },
        sort: 'id',
      })
      projectSnapshot = [
        project.id,
        project.updatedAt,
        grants.docs.map((grant) => [grant.id, grant.updatedAt]),
        project.membershipRevision ?? 0,
      ]
    }
    snapshot.push([
      id,
      board.owner,
      board.visibility,
      board.updatedAt,
      members.docs.map((m) => [m.id, m.user, m.role, m.updatedAt]),
      projectSnapshot,
      board.membershipRevision ?? 0,
    ])
  }
  const authority = workspaceAuthority(req)
  // Each owner reviews the same audience under their own live authority.
  // Keep actor checks in the publication guard; retain scope and epoch here.
  const fingerprint = JSON.stringify([
    ...snapshot,
    ...(authority
      ? [
          {
            authority: {
              organization: authority.organization,
              site: authority.site,
              epoch: authority.epoch,
            },
          },
        ]
      : []),
  ])
  if (authority) snapshot.push({ authority })
  return { owners: [...owners], fingerprint, snapshot }
}

/** D1 batch is atomic. A failed guard rolls back the complete audience/placement change. */
async function placementBatch(
  req: PayloadRequest,
  taskID: number,
  boardID: number,
  add: boolean,
  section: number | null,
  expected: string,
  snapshot: unknown[],
  lastAction?: string,
  sharingRequest?: { id: number; fingerprint: string; updatedAt: string },
) {
  const binding = (req.payload.db as unknown as { binding: D1Database }).binding
  // Local development schema push does not run production-only guard-table migrations.
  await binding
    .prepare(
      'CREATE TABLE IF NOT EXISTS task_workspace_guards (id text PRIMARY KEY NOT NULL, valid integer NOT NULL CHECK (valid = 1))',
    )
    .run()
  const statements: D1PreparedStatement[] = []
  const now = new Date().toISOString()
  const guardID = crypto.randomUUID()
  const checks: string[] = ['EXISTS (SELECT 1 FROM review_tasks WHERE id = ? AND updated_at = ?)']
  const bindings: (string | number)[] = [taskID, expected]
  if (sharingRequest) {
    checks.push(
      "EXISTS (SELECT 1 FROM task_sharing_requests WHERE id = ? AND state = 'pending' AND fingerprint = ? AND updated_at = ?)",
    )
    bindings.push(sharingRequest.id, sharingRequest.fingerprint, sharingRequest.updatedAt)
  }
  const audiences = snapshot.filter((item) => {
    if (item && typeof item === 'object' && 'authority' in item) {
      const check = workspaceAuthorityCheck(item.authority as WorkspaceAuthority)
      checks.push(check.query)
      bindings.push(...check.values)
      return false
    }
    return true
  })
  for (const item of audiences as [
    string,
    number,
    string,
    string,
    [number, number, string, string][],
    [number, string, [number, string][], number] | null,
    number,
  ][]) {
    checks.push(
      'EXISTS (SELECT 1 FROM task_boards WHERE id = ? AND owner_id = ? AND visibility = ? AND updated_at = ? AND archived != 1 AND coalesce(membership_revision,0)=?)',
    )
    bindings.push(Number(item[0]), Number(item[1]), item[2], item[3], item[6])
    checks.push('(SELECT COUNT(*) FROM task_board_memberships WHERE board_id = ?) = ?')
    bindings.push(Number(item[0]), item[4].length)
    for (const member of item[4]) {
      checks.push(
        'EXISTS (SELECT 1 FROM task_board_memberships WHERE id = ? AND user_id = ? AND role = ? AND updated_at = ?)',
      )
      bindings.push(member[0], Number(member[1]), member[2], member[3])
    }
    if (item[5]) {
      const [projectID, updatedAt, grants, revision] = item[5]
      checks.push(
        'EXISTS(SELECT 1 FROM task_projects WHERE id=? AND updated_at=? AND archived!=1 AND coalesce(membership_revision,0)=?)',
      )
      bindings.push(projectID, updatedAt, revision)
      checks.push('(SELECT count(*) FROM task_project_memberships WHERE project_id=?)=?')
      bindings.push(projectID, grants.length)
      for (const grant of grants) {
        checks.push('EXISTS(SELECT 1 FROM task_project_memberships WHERE id=? AND updated_at=?)')
        bindings.push(grant[0], grant[1])
      }
    }
  }
  // Split guards into bounded statements; every guard remains in the same atomic batch.
  let offset = 0
  for (let i = 0; i < checks.length; i++) {
    const count = (checks[i].match(/\?/g) ?? []).length
    statements.push(
      binding
        .prepare(
          `INSERT INTO task_workspace_guards (id, valid) VALUES (?, CASE WHEN ${checks[i]} THEN 1 ELSE 0 END)`,
        )
        .bind(`${guardID}:${i}`, ...bindings.slice(offset, offset + count)),
    )
    offset += count
  }
  const taskSet = '(SELECT id FROM review_tasks WHERE id = ? OR parent_id = ?)'
  if (add) {
    statements.push(
      binding
        .prepare(
          `INSERT INTO review_tasks_rels (parent_id, path, task_boards_id) SELECT id, 'boards', ? FROM review_tasks WHERE (id = ? OR parent_id = ?) AND NOT EXISTS (SELECT 1 FROM review_tasks_rels r WHERE r.parent_id = review_tasks.id AND r.path = 'boards' AND r.task_boards_id = ?)`,
        )
        .bind(boardID, taskID, taskID, boardID),
    )
    statements.push(
      binding
        .prepare(
          'INSERT INTO task_placements (task_id, board_id, section_id, position, key, active, created_at, updated_at) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM task_placements WHERE board_id = ? AND active = 1), ?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET active = 1, section_id = excluded.section_id, updated_at = excluded.updated_at',
        )
        .bind(taskID, boardID, section, boardID, `${taskID}:${boardID}`, now, now),
    )
    statements.push(
      binding
        .prepare(`UPDATE review_tasks SET personal = 0, updated_at = ? WHERE id IN ${taskSet}`)
        .bind(now, taskID, taskID),
    )
  } else {
    statements.push(
      binding
        .prepare(
          `DELETE FROM review_tasks_rels WHERE path = 'boards' AND task_boards_id = ? AND parent_id IN ${taskSet}`,
        )
        .bind(boardID, taskID, taskID),
    )
    statements.push(
      binding
        .prepare(
          'UPDATE task_placements SET active = 0, updated_at = ? WHERE task_id = ? AND board_id = ?',
        )
        .bind(now, taskID, boardID),
    )
    if (lastAction)
      statements.push(
        binding
          .prepare(
            `UPDATE review_tasks SET personal = 1, archived = ?, updated_at = ? WHERE id IN ${taskSet}`,
          )
          .bind(lastAction === 'archive' ? 1 : 0, now, taskID, taskID),
      )
    else
      statements.push(
        binding
          .prepare(`UPDATE review_tasks SET updated_at = ? WHERE id IN ${taskSet}`)
          .bind(now, taskID, taskID),
      )
  }
  if (sharingRequest)
    statements.push(
      binding
        .prepare("UPDATE task_sharing_requests SET state = 'approved', updated_at = ? WHERE id = ?")
        .bind(now, sharingRequest.id),
    )
  for (let i = 0; i < checks.length; i++)
    statements.push(
      binding.prepare('DELETE FROM task_workspace_guards WHERE id = ?').bind(`${guardID}:${i}`),
    )
  try {
    await binding.batch([...(await mutationFence(req)), ...statements])
  } catch {
    reject('The task or board membership changed. Reload and try again.', 409)
  }
}

export const workspaceEndpoint: Endpoint = {
  path: '/:id/workspace',
  method: 'post',
  handler: async (req) => {
    const body = (await req.json?.()) as Record<string, unknown>
    if (!req.user || !body) reject('Sign in.', 401)
    const task = await requireTask(req, req.routeParams?.id)
    const action = String(body.action)
    if (action === 'follow') {
      const key = `${task.id}:${req.user.id}`
      const existing = await req.payload.find({
        collection: 'task-followers',
        req,
        overrideAccess: false,
        depth: 0,
        limit: 1,
        where: { key: { equals: key } },
      })
      const data = {
        task: task.id,
        user: req.user.id,
        key,
        following: body.following !== false,
        muted: body.muted === true,
      }
      if (existing.docs[0])
        await req.payload.update({
          collection: 'task-followers',
          id: existing.docs[0].id,
          req,
          overrideAccess: false,
          data,
        })
      else
        await req.payload.create({ collection: 'task-followers', req, overrideAccess: false, data })
      return Response.json({ ok: true })
    }
    if (task.parent) reject('Manage board placement through the parent task.', 400)
    const destination = relationID(body.board)
    if (action === 'share' || action === 'approve' || action === 'reject') {
      if (action === 'share' && body.confirm !== true)
        reject('Confirm sharing the complete task, existing discussion, and subtasks.', 400)
      let request
      if (action !== 'share') {
        request = await req.payload.findByID({
          collection: 'task-sharing-requests',
          id: relationID(body.request),
          req,
          overrideAccess: true,
          depth: 0,
        })
        if (relationID(request.task) !== String(task.id) || request.state !== 'pending')
          reject('This sharing request is no longer pending.', 409)
        if (!isAdministrator(req) && !ids(request.approvers).includes(String(req.user.id)))
          reject('Only the required board owners can approve this request.')
      } else await requireTask(req, task.id, 'edit')
      const target = request ? relationID(request.destination) : destination
      if (!request) await requireBoard(req, target, 'edit')
      if (ids(task.boards).includes(target)) reject('This task is already on that board.', 400)
      const current = await audience(req, task, target)
      if (request && request.fingerprint !== current.fingerprint) {
        await req.payload.update({
          collection: 'task-sharing-requests',
          id: request.id,
          req: workspaceReq(req),
          overrideAccess: true,
          data: { state: 'stale' },
        })
        reject('Membership changed. Submit a new sharing request.', 409)
      }
      if (action === 'reject') {
        await req.payload.update({
          collection: 'task-sharing-requests',
          id: request!.id,
          req: workspaceReq(req),
          overrideAccess: true,
          data: { state: 'rejected' },
        })
        return Response.json({ ok: true })
      }
      const approved = [...new Set([...ids(request?.approved), String(req.user.id)])]
      const requester = request
        ? await req.payload.findByID({
            collection: 'users',
            id: relationID(request.requester),
            req,
            depth: 0,
            overrideAccess: true,
          })
        : req.user
      await requireBoard(
        { ...req, user: { ...requester, collection: 'users' } } as PayloadRequest,
        target,
        'edit',
      )
      const allowed =
        isAdministrator(req) || current.owners.every((owner) => approved.includes(owner))
      if (!allowed || request) {
        const data = {
          task: task.id,
          destination: Number(target),
          requester: request?.requester ?? req.user.id,
          approvers: current.owners.map(Number),
          approved: approved.map(Number),
          fingerprint: current.fingerprint,
          state: 'pending' as const,
        }
        request = request
          ? await req.payload.update({
              collection: 'task-sharing-requests',
              id: request.id,
              req: workspaceReq(req),
              overrideAccess: true,
              data,
            })
          : await req.payload.create({
              collection: 'task-sharing-requests',
              req: workspaceReq(req),
              overrideAccess: true,
              data,
            })
        if (!allowed) {
          for (const owner of current.owners)
            if (!approved.includes(owner))
              await queueBoardEvent(req, {
                recipient: owner,
                task: String(task.id),
                request: String(request.id),
                kind: 'approval',
                key: `approval:${request.id}`,
              })
          return Response.json({ ok: true, pending: true })
        }
      }
      if (body.confirm !== true && action === 'share')
        reject(
          'Confirm that this shares all task details, comments, and subtasks with the destination board.',
          400,
        )
      await placementBatch(
        req,
        task.id,
        Number(target),
        true,
        null,
        task.updatedAt,
        current.snapshot,
        undefined,
        request
          ? { id: request.id, fingerprint: current.fingerprint, updatedAt: request.updatedAt }
          : undefined,
      )
      await boardAudit(req, target, `Task #${task.id} added to board`, task.id)
      return Response.json({ ok: true })
    }
    if (action === 'remove') {
      await requireBoard(req, destination, 'owner')
      if (!ids(task.boards).includes(destination)) reject('Task is not on this board.', 400)
      const last = ids(task.boards).length === 1
      if (last && !['archive', 'personal'].includes(String(body.lastAction)))
        reject('Choose Archive or Make personal when removing the last board.', 400)
      const current = await audience(req, task, destination)
      await placementBatch(
        req,
        task.id,
        Number(destination),
        false,
        null,
        String(body.expectedUpdatedAt ?? task.updatedAt),
        current.snapshot,
        last ? String(body.lastAction) : undefined,
      )
      await boardAudit(req, destination, `Task #${task.id} removed from board`, task.id)
      return Response.json({ ok: true })
    }
    if (action === 'move') {
      await requireBoard(req, destination, 'edit')
      await requireTask(req, task.id, 'edit')
      const placement = await req.payload.find({
        collection: 'task-placements',
        req,
        overrideAccess: true,
        depth: 0,
        limit: 1,
        where: { key: { equals: `${task.id}:${destination}` } },
      })
      const current = placement.docs[0]
      if (!current?.active) reject('Placement not found.', 404)
      if (body.expectedUpdatedAt !== current.updatedAt)
        reject('This card moved. Reload before moving it again.', 409)
      const section = body.section
        ? await req.payload.findByID({
            collection: 'task-sections',
            id: relationID(body.section),
            req,
            overrideAccess: false,
            depth: 0,
          })
        : null
      if (section && (relationID(section.board) !== destination || section.archived))
        reject('Choose an active section on this board.', 400)
      const position = Number(body.position ?? 0)
      if (!Number.isFinite(position)) reject('Invalid card position.', 400)
      const sectionID = section?.id ?? null,
        next = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString()
      const db = workspaceDB(req)
      const changes = await db.batch([
        ...(await workspaceMutationFence(req, { task: task.id, board: destination }, async () => {
          await requireTask(req, task.id, 'edit')
          await requireBoard(req, destination, 'edit')
        })),
        db
          .prepare(
            'UPDATE task_placements SET section_id=?,position=?,updated_at=? WHERE id=? AND updated_at=? AND active=1 AND (? IS NULL OR EXISTS(SELECT 1 FROM task_sections WHERE id=? AND board_id=? AND archived!=1))',
          )
          .bind(
            sectionID,
            position,
            next,
            current.id,
            current.updatedAt,
            sectionID,
            sectionID,
            Number(destination),
          ),
      ])
      const changed = changes.at(-1)!
      if (!changed.meta.changes)
        reject('This card or its section changed. Reload before moving it again.', 409)
      await boardAudit(req, destination, `Task #${task.id} moved`, task.id)
      return Response.json({ ok: true })
    }
    reject('Unknown workspace action.', 400)
  },
}
