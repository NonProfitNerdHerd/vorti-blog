import type { CollectionConfig, Endpoint, PayloadRequest } from 'payload'
import { isAdministrator, relationID } from './documents'
import {
  boardRole,
  reject,
  requireBoard,
  workspaceReq,
  workspaceDB,
  ensureWorkspaceGuards,
} from './workspace-access'
import { requireProject } from './project-access'
import { boardAudit } from './workspace-collections'
import { queueBoardEvent } from './notifications'
import { workspaceAuthority, workspaceAuthorityCheck } from '../organizations/workspace-authority'

type Check = { query: string; values: (string | number)[] }
async function changeSnapshot(
  req: PayloadRequest,
  boardID: number,
  projectID: number,
  inherit: boolean,
) {
  const board = await req.payload.findByID({
    collection: 'task-boards',
    id: boardID,
    req: workspaceReq(req),
    overrideAccess: true,
    depth: 0,
  })
  const destination = await req.payload.findByID({
    collection: 'task-projects',
    id: projectID,
    req: workspaceReq(req),
    overrideAccess: true,
    depth: 0,
  })
  if ((board.platformSite || null) !== (destination.platformSite || null))
    reject('Boards cannot move between site audiences.')
  const tasks = await req.payload.find({
    collection: 'review-tasks',
    req,
    overrideAccess: true,
    depth: 0,
    pagination: false,
    where: { and: [{ boards: { equals: boardID } }, { parent: { exists: false } }] },
  })
  const boards = new Set<number>([boardID]),
    owners = new Set<number>(),
    checks: Check[] = [],
    fingerprint: unknown[] = []
  for (const task of tasks.docs) {
    checks.push({
      query: 'EXISTS(SELECT 1 FROM review_tasks WHERE id=? AND updated_at=?)',
      values: [task.id, task.updatedAt],
    })
    for (const id of task.boards ?? []) boards.add(Number(relationID(id)))
  }
  checks.push({
    query: '(SELECT count(*) FROM review_tasks_rels WHERE task_boards_id=?)=?',
    values: [
      boardID,
      (await workspaceDB(req)
        .prepare('SELECT count(*) AS total FROM review_tasks_rels WHERE task_boards_id=?')
        .bind(boardID)
        .first<{ total: number }>())!.total,
    ],
  })
  const projects = new Set<number>([projectID])
  const inheritedSources = new Set<number>()
  const authority = workspaceAuthority(req)
  if (authority) {
    checks.push(workspaceAuthorityCheck(authority))
    // Other source owners review the same scope under their own live actor
    // check; changing reviewers must not invalidate an unchanged audience.
    fingerprint.push({
      authority: {
        organization: authority.organization,
        site: authority.site,
        epoch: authority.epoch,
      },
    })
  }
  if (board.project) projects.add(Number(relationID(board.project)))
  for (const id of boards) {
    const item = await req.payload.findByID({
      collection: 'task-boards',
      id,
      req: workspaceReq(req),
      overrideAccess: true,
      depth: 0,
    })
    owners.add(Number(relationID(item.owner)))
    fingerprint.push([
      id,
      item.updatedAt,
      item.owner,
      item.project,
      item.inheritProject,
      item.membershipRevision ?? 0,
    ])
    checks.push({
      query:
        'EXISTS(SELECT 1 FROM task_boards WHERE id=? AND updated_at=? AND coalesce(membership_revision,0)=?)',
      values: [id, item.updatedAt, item.membershipRevision ?? 0],
    })
    if (item.project) projects.add(Number(relationID(item.project)))
    if (item.project && item.inheritProject) inheritedSources.add(Number(relationID(item.project)))
    const members = await req.payload.find({
      collection: 'task-board-memberships',
      req: workspaceReq(req),
      overrideAccess: true,
      depth: 0,
      pagination: false,
      sort: 'id',
      where: { board: { equals: id } },
    })
    fingerprint.push(
      members.docs.map((member) => [member.id, member.user, member.role, member.updatedAt]),
    )
    checks.push({
      query: '(SELECT count(*) FROM task_board_memberships WHERE board_id=?)=?',
      values: [id, members.totalDocs],
    })
    for (const member of members.docs)
      checks.push({
        query: 'EXISTS(SELECT 1 FROM task_board_memberships WHERE id=? AND updated_at=?)',
        values: [member.id, member.updatedAt],
      })
  }
  for (const id of projects) {
    const project = await req.payload.findByID({
      collection: 'task-projects',
      id,
      req: workspaceReq(req),
      overrideAccess: true,
      depth: 0,
    })
    if (inheritedSources.has(id)) owners.add(Number(relationID(project.owner)))
    fingerprint.push([
      id,
      project.owner,
      project.visibility,
      project.updatedAt,
      project.membershipRevision ?? 0,
    ])
    checks.push({
      query:
        'EXISTS(SELECT 1 FROM task_projects WHERE id=? AND updated_at=? AND coalesce(membership_revision,0)=?)',
      values: [id, project.updatedAt, project.membershipRevision ?? 0],
    })
    const members = await req.payload.find({
      collection: 'task-project-memberships',
      req: workspaceReq(req),
      overrideAccess: true,
      depth: 0,
      pagination: false,
      sort: 'id',
      where: { project: { equals: id } },
    })
    fingerprint.push(
      members.docs.map((member) => [member.id, member.user, member.role, member.updatedAt]),
    )
    checks.push({
      query: '(SELECT count(*) FROM task_project_memberships WHERE project_id=?)=?',
      values: [id, members.totalDocs],
    })
    for (const member of members.docs)
      checks.push({
        query: 'EXISTS(SELECT 1 FROM task_project_memberships WHERE id=? AND updated_at=?)',
        values: [member.id, member.updatedAt],
      })
  }
  return {
    board,
    owners: [...owners],
    checks,
    fingerprint: JSON.stringify([
      projectID,
      inherit,
      fingerprint,
      tasks.docs.map((task) => [task.id, task.updatedAt]),
    ]),
    taskCount: tasks.totalDocs,
  }
}
export const TaskProjectChanges: CollectionConfig = {
  slug: 'task-project-changes',
  admin: { hidden: true },
  access: {
    read: ({ req }) =>
      !req.user
        ? false
        : isAdministrator(req)
          ? true
          : {
              or: [{ requester: { equals: req.user.id } }, { approvers: { equals: req.user.id } }],
            },
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'board', type: 'relationship', relationTo: 'task-boards', required: true },
    { name: 'destination', type: 'relationship', relationTo: 'task-projects', required: true },
    { name: 'inheritProject', type: 'checkbox' },
    { name: 'requester', type: 'relationship', relationTo: 'users', required: true },
    { name: 'approvers', type: 'relationship', relationTo: 'users', hasMany: true },
    { name: 'approved', type: 'relationship', relationTo: 'users', hasMany: true },
    { name: 'fingerprint', type: 'textarea', access: { read: () => false } },
    {
      name: 'state',
      type: 'select',
      options: ['pending', 'approved', 'rejected', 'invalidated'],
      defaultValue: 'pending',
      index: true,
    },
  ],
  hooks: {
    afterRead: [
      async ({ doc, req, overrideAccess }) => {
        if (overrideAccess) return doc
        let board = null,
          destination = null
        try {
          if (await boardRole(req, doc.board)) board = doc.board
        } catch {}
        try {
          await requireProject(req, doc.destination)
          destination = doc.destination
        } catch {}
        return {
          ...doc,
          board,
          destination,
          approvers: (doc.approvers ?? []).filter(
            (id: unknown) => relationID(id) === String(req.user?.id),
          ),
          approved: (doc.approved ?? []).filter(
            (id: unknown) => relationID(id) === String(req.user?.id),
          ),
          fingerprint: undefined,
        }
      },
    ],
  },
}

export const projectSharingEndpoints: Endpoint[] = [
  {
    path: '/task-workspace/project-sharing',
    method: 'post',
    handler: async (req) => {
      if (!req.user) reject('Sign in.', 401)
      const body = (await req.json!()) as Record<string, any>
      if (body.action === 'preview' || body.action === 'request') {
        await requireBoard(req, body.board, 'owner')
        await requireBoard(req, body.board, 'edit')
        await requireProject(req, body.project, 'edit')
        const snapshot = await changeSnapshot(
          req,
          Number(body.board),
          Number(body.project),
          !!body.inheritProject,
        )
        if (body.action === 'preview')
          return Response.json({
            taskCount: snapshot.taskCount,
            approvalsRequired: snapshot.owners.length,
            warning:
              'This changes the audience for tasks, subtasks, comments, attachments, and shared field values. Private boards and documents remain protected.',
          })
        if (!body.confirm) reject('Confirm the audience change before continuing.', 400)
        // Audience reductions on the same project do not need sharing approvals.
        const reducing =
          relationID(snapshot.board.project) === String(body.project) &&
          snapshot.board.inheritProject &&
          !body.inheritProject
        const approved =
          reducing || isAdministrator(req)
            ? snapshot.owners
            : snapshot.owners.filter((id) => id === req.user!.id)
        const request = await req.payload.create({
          collection: 'task-project-changes',
          req,
          overrideAccess: true,
          depth: 0,
          data: {
            board: Number(body.board),
            destination: Number(body.project),
            inheritProject: !!body.inheritProject,
            requester: req.user!.id,
            approvers: snapshot.owners,
            approved,
            fingerprint: snapshot.fingerprint,
            state: 'pending',
          },
        })
        for (const owner of snapshot.owners)
          if (!approved.includes(owner))
            await queueBoardEvent(req, {
              recipient: String(owner),
              kind: 'approval',
              key: `project-change:${request.id}`,
              projectChange: String(request.id),
            })
        if (approved.length < snapshot.owners.length)
          return Response.json({ pending: true, id: request.id })
        await applyChange(req, request, snapshot)
        return Response.json({ applied: true })
      }
      const request = await req.payload.findByID({
        collection: 'task-project-changes',
        id: body.request,
        req,
        overrideAccess: true,
        depth: 0,
      })
      const approvers = (request.approvers ?? []).map(relationID),
        approved = (request.approved ?? []).map(relationID)
      if (!isAdministrator(req) && !approvers.includes(String(req.user!.id)))
        reject('This request is unavailable.')
      if (request.state !== 'pending') reject('This request is no longer pending.', 409)
      if (body.action === 'reject') {
        await req.payload.update({
          collection: 'task-project-changes',
          id: request.id,
          req,
          overrideAccess: true,
          data: { state: 'rejected' },
        })
        return Response.json({ rejected: true })
      }
      if (body.action !== 'approve') reject('Unsupported sharing action.', 400)
      const requester = await req.payload.findByID({
          collection: 'users',
          id: relationID(request.requester),
          req,
          overrideAccess: true,
          depth: 0,
        }),
        requestReq = { ...req, user: { ...requester, collection: 'users' } } as PayloadRequest
      await requireBoard(requestReq, request.board, 'owner')
      await requireProject(requestReq, request.destination, 'edit')
      const snapshot = await changeSnapshot(
        req,
        Number(relationID(request.board)),
        Number(relationID(request.destination)),
        !!request.inheritProject,
      )
      if (snapshot.fingerprint !== request.fingerprint) {
        await req.payload.update({
          collection: 'task-project-changes',
          id: request.id,
          req,
          overrideAccess: true,
          data: { state: 'invalidated' },
        })
        reject('Membership or work changed. Start a new sharing request.', 409)
      }
      const next = isAdministrator(req)
        ? approvers
        : [...new Set([...approved, String(req.user!.id)])]
      if (approvers.every((id) => next.includes(id))) await applyChange(req, request, snapshot)
      else
        await req.payload.update({
          collection: 'task-project-changes',
          id: request.id,
          req,
          overrideAccess: true,
          data: { approved: next.map(Number) },
        })
      return Response.json({ pending: !approvers.every((id) => next.includes(id)) })
    },
  },
]
async function applyChange(
  req: PayloadRequest,
  request: { id: number; updatedAt: string; destination: unknown; inheritProject?: boolean | null },
  snapshot: Awaited<ReturnType<typeof changeSnapshot>>,
) {
  const db = workspaceDB(req),
    guard = crypto.randomUUID(),
    now = new Date().toISOString(),
    checks = snapshot.checks.map((check, index) =>
      db
        .prepare(
          `INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN ${check.query} THEN 1 ELSE 0 END)`,
        )
        .bind(`${guard}:${index}`, ...check.values),
    )
  checks.push(
    db
      .prepare(
        "INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM task_project_changes WHERE id=? AND updated_at=? AND state='pending') THEN 1 ELSE 0 END)",
      )
      .bind(guard, request.id, request.updatedAt),
  )
  checks.push(
    db
      .prepare('UPDATE task_boards SET project_id=?,inherit_project=?,updated_at=? WHERE id=?')
      .bind(
        Number(relationID(request.destination)),
        request.inheritProject ? 1 : 0,
        now,
        snapshot.board.id,
      ),
    db
      .prepare("UPDATE task_project_changes SET state='approved',updated_at=? WHERE id=?")
      .bind(now, request.id),
    db
      .prepare('DELETE FROM task_workspace_guards WHERE id=? OR id LIKE ?')
      .bind(guard, `${guard}:%`),
  )
  await ensureWorkspaceGuards(req)
  try {
    await db.batch(checks)
  } catch {
    reject('The audience changed while approving. Reload and start a new request.', 409)
  }
  await boardAudit(req, String(snapshot.board.id), 'Board project sharing changed')
}
