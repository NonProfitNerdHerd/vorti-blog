import type { PayloadRequest } from 'payload'
import {
  workspaceDB,
  ensureWorkspaceGuards,
  requireBoard,
  requireTask,
  reject,
} from './workspace-access'
import { workspaceMutationFence } from './workspace-commit'
import { relationID } from './documents'
export async function addBoardDependency(
  req: PayloadRequest,
  task: any,
  predecessor: any,
  revision: string,
) {
  const board = (task.boards ?? [])
    .map(relationID)
    .find((id: string) => (predecessor.boards ?? []).map(relationID).includes(id))
  if (!board) reject('Choose an accessible predecessor on this board.', 400)
  await requireBoard(req, board, 'edit')
  const db = workspaceDB(req),
    guard = crypto.randomUUID(),
    now = new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString()
  await ensureWorkspaceGuards(req)
  try {
    await db.batch([
      ...(await workspaceMutationFence(
        req,
        { task: task.id, predecessor: predecessor.id },
        async () => {
          await requireTask(req, task.id, 'edit')
          await requireTask(req, predecessor.id)
          await requireBoard(req, board, 'edit')
        },
      )),
      db
        .prepare(
          `INSERT INTO task_workspace_guards(id,valid) SELECT ?,CASE WHEN NOT EXISTS(WITH RECURSIVE links(task_id,predecessor_id) AS (SELECT task_id,predecessor_id FROM task_dependencies UNION SELECT task_id,predecessor_id FROM task_board_dependencies), chain(id) AS (SELECT predecessor_id FROM links WHERE task_id=? UNION SELECT d.predecessor_id FROM links d JOIN chain c ON d.task_id=c.id) SELECT 1 FROM chain WHERE id=?) AND EXISTS(SELECT 1 FROM review_tasks WHERE id=? AND updated_at=?) THEN 1 ELSE 0 END`,
        )
        .bind(guard, predecessor.id, task.id, task.id, revision),
      db
        .prepare(
          'INSERT INTO task_board_dependencies(task_id,predecessor_id,board_id) VALUES(?,?,?)',
        )
        .bind(task.id, predecessor.id, Number(board)),
      db.prepare('UPDATE review_tasks SET updated_at=? WHERE id=?').bind(now, task.id),
      db.prepare('DELETE FROM task_workspace_guards WHERE id=?').bind(guard),
    ])
  } catch {
    reject(
      'Dependency changed, already exists, or would create a cycle. Reload before retrying.',
      409,
    )
  }
  return { created: true, updatedAt: now }
}
export async function removeBoardDependency(
  req: PayloadRequest,
  task: any,
  id: number,
  revision: string,
) {
  const db = workspaceDB(req),
    guard = crypto.randomUUID(),
    now = new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString()
  await ensureWorkspaceGuards(req)
  try {
    await db.batch([
      ...(await workspaceMutationFence(req, { task: task.id }, () =>
        requireTask(req, task.id, 'edit'),
      )),
      db
        .prepare(
          'INSERT INTO task_workspace_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM review_tasks WHERE id=? AND updated_at=?) AND EXISTS(SELECT 1 FROM task_board_dependencies WHERE id=? AND task_id=?) THEN 1 ELSE 0 END',
        )
        .bind(guard, task.id, revision, id, task.id),
      db.prepare('DELETE FROM task_board_dependencies WHERE id=? AND task_id=?').bind(id, task.id),
      db.prepare('UPDATE review_tasks SET updated_at=? WHERE id=?').bind(now, task.id),
      db.prepare('DELETE FROM task_workspace_guards WHERE id=?').bind(guard),
    ])
  } catch {
    reject('This dependency changed. Reload before retrying.', 409)
  }
  return { removed: true, updatedAt: now }
}
