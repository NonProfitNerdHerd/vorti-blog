import type { Field, PayloadRequest } from 'payload'
import { internalWorkspace, reject, workspaceDB, workspaceReq } from './workspace-access'

export const starterKeyField: Field = {
  name: 'starterKey',
  type: 'text',
  unique: true,
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false },
}

export function protectStarterFields(
  data: Record<string, unknown> | undefined,
  req: PayloadRequest,
) {
  if (!internalWorkspace(req) && data) {
    delete data.starterKey
    delete data.workspaceInitialized
  }
}

/** One atomic, repeatable initialization shared by ordinary and starter boards.
 * Conditional inserts inside a D1 batch serialize competing requests. Never call
 * this for an already initialized workspace: removed columns/views stay removed.
 */
export async function initializeBoardDefaults(req: PayloadRequest, board: number) {
  const db = workspaceDB(req)
  await db.batch([
    db
      .prepare(
        `INSERT INTO task_field_definitions(name,kind,creator_id,system_key,configuration)
      VALUES ('Estimated hours','number',?,'estimated-hours','{"precision":2}')
      ON CONFLICT(system_key) DO NOTHING`,
      )
      .bind(req.user!.id),
    db
      .prepare(
        `INSERT INTO task_board_fields(board_id,field_id,position,key)
      SELECT ?,id,0,? || ':' || id FROM task_field_definitions
      WHERE system_key='estimated-hours' ON CONFLICT(key) DO NOTHING`,
      )
      .bind(board, board),
    ...['overview', 'list', 'board', 'gantt', 'calendar', 'files'].map((kind, position) =>
      db
        .prepare(
          `INSERT INTO task_views(board_id,name,kind,position,default_view)
        SELECT ?,?,?,?,? WHERE NOT EXISTS
        (SELECT 1 FROM task_views WHERE board_id=? AND kind=?)`,
        )
        .bind(
          board,
          kind === 'gantt' ? 'Timeline' : kind[0].toUpperCase() + kind.slice(1),
          kind,
          position,
          kind === 'list' ? 1 : 0,
          board,
          kind,
        ),
    ),
  ])
}

export async function initializeStarterWorkspace(req: PayloadRequest) {
  if (!req.user) reject('Sign in.', 401)
  const user = await req.payload.findByID({
    collection: 'users',
    id: req.user.id,
    req: workspaceReq(req),
    overrideAccess: true,
    depth: 0,
  })
  if (user.workspaceInitialized) return
  const projectKey = `work:${req.user.id}`,
    boardKey = `personal-todos:${req.user.id}`
  const findProject = async () =>
    (
      await req.payload.find({
        collection: 'task-projects',
        req: workspaceReq(req),
        overrideAccess: true,
        depth: 0,
        limit: 1,
        where: { starterKey: { equals: projectKey } },
      })
    ).docs[0]
  let project = await findProject()
  if (!project) {
    try {
      project = await req.payload.create({
        collection: 'task-projects',
        req: workspaceReq(req),
        overrideAccess: true,
        depth: 0,
        data: { name: 'Work', visibility: 'private', starterKey: projectKey },
      })
    } catch (error) {
      // A competing request may already have committed the unique starter record.
      project = await findProject()
      if (!project) throw error
    }
  }
  const findBoard = async () =>
    (
      await req.payload.find({
        collection: 'task-boards',
        req: workspaceReq(req),
        overrideAccess: true,
        depth: 0,
        limit: 1,
        where: { starterKey: { equals: boardKey } },
      })
    ).docs[0]
  let board = await findBoard()
  if (!board) {
    try {
      board = await req.payload.create({
        collection: 'task-boards',
        req: workspaceReq(req),
        overrideAccess: true,
        depth: 0,
        data: {
          name: "Personal To-Do's",
          owner: req.user.id,
          project: project.id,
          inheritProject: true,
          visibility: 'private',
          starterKey: boardKey,
        },
      })
    } catch (error) {
      board = await findBoard()
      if (!board) throw error
    }
  }
  await initializeBoardDefaults(req, board.id)
  // No client-supplied account ID or marker is accepted. A failed earlier step
  // leaves the marker unset, so the next workspace visit can finish safely.
  // This bookkeeping write must not run an authentication collection update:
  // concurrent Payload updates can replace session-array rows during login.
  await workspaceDB(req)
    .prepare('UPDATE users SET workspace_initialized=1 WHERE id=?')
    .bind(req.user.id)
    .run()
}
