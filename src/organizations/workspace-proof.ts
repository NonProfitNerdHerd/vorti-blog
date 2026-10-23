import { APIError, type PayloadRequest } from 'payload'
import { cmsDatabase } from './cms-scope'

interface Witness {
  id: number
  revision?: number
  updated: string | null
}
export interface WorkspaceProof {
  boards: Witness[]
  projects: Witness[]
  tasks: Witness[]
}
const id = (value: unknown): number | null => {
  if (value && typeof value === 'object' && 'id' in value) value = value.id
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}
/** Snapshot before permission hooks run. Those hooks authorize against this state or a
 * later state; the commit guard rejects any intervening audience/record change. */
export async function captureWorkspaceProof(
  req: PayloadRequest,
  slug: string,
  data: Record<string, unknown>,
  original: Record<string, unknown> = {},
): Promise<WorkspaceProof> {
  const result: WorkspaceProof = { boards: [], projects: [], tasks: [] }
  if (!slug.startsWith('task-') && !slug.startsWith('review-')) return result
  const boards = new Set<number>(),
    projects = new Set<number>(),
    tasks = new Set<number>()
  const add = (set: Set<number>, value: unknown) => {
    const number = id(value)
    if (number) set.add(number)
  }
  for (const source of [data, original]) {
    const value = (name: string, sql: string) => source[name] ?? source[sql]
    add(boards, value('board', 'board_id'))
    add(boards, source.initialBoard)
    add(projects, value('project', 'project_id'))
    add(tasks, value('task', 'task_id'))
    if (slug === 'review-tasks') add(tasks, value('parent', 'parent_id'))
    add(tasks, value('predecessor', 'predecessor_id'))
    if (slug === 'task-project-changes') add(projects, value('destination', 'destination_id'))
    if (slug === 'task-sharing-requests') add(boards, value('destination', 'destination_id'))
    if (Array.isArray(source.boards)) for (const board of source.boards) add(boards, board)
  }
  if (slug === 'task-boards') add(boards, original.id)
  if (slug === 'task-projects') add(projects, original.id)
  if (slug === 'review-tasks') add(tasks, original.id)
  const db = cmsDatabase(req)
  const pages = async (ids: Set<number>, visit: (values: number[]) => Promise<void>) => {
    if (ids.size > 200) throw new APIError('Review a smaller set of workspace references.', 400)
    const values = [...ids]
    for (let offset = 0; offset < values.length; offset += 75)
      await visit(values.slice(offset, offset + 75))
  }
  await pages(tasks, async (values) => {
    const rows = (
      await db
        .prepare(
          `SELECT id,updated_at AS updated FROM review_tasks WHERE id IN(${values.map(() => '?').join(',')})`,
        )
        .bind(...values)
        .all<Witness>()
    ).results
    if (rows.length !== values.length) throw new APIError('Task unavailable.', 403)
    result.tasks.push(...rows)
    const relations = (
      await db
        .prepare(
          `SELECT task_boards_id AS id FROM review_tasks_rels WHERE path='boards' AND parent_id IN(${values.map(() => '?').join(',')})`,
        )
        .bind(...values)
        .all<{ id: number }>()
    ).results
    for (const relation of relations) boards.add(relation.id)
  })
  await pages(boards, async (values) => {
    const rows = (
      await db
        .prepare(
          `SELECT id,COALESCE(membership_revision,0) AS revision,updated_at AS updated,project_id FROM task_boards WHERE id IN(${values.map(() => '?').join(',')})`,
        )
        .bind(...values)
        .all<Witness & { project_id: number | null }>()
    ).results
    if (rows.length !== values.length) throw new APIError('Board unavailable.', 403)
    result.boards.push(
      ...rows.map(({ project_id, ...row }) => {
        if (project_id) projects.add(project_id)
        return row
      }),
    )
  })
  await pages(projects, async (values) => {
    const rows = (
      await db
        .prepare(
          `SELECT id,COALESCE(membership_revision,0) AS revision,updated_at AS updated FROM task_projects WHERE id IN(${values.map(() => '?').join(',')})`,
        )
        .bind(...values)
        .all<Witness>()
    ).results
    if (rows.length !== values.length) throw new APIError('Project unavailable.', 403)
    result.projects.push(...rows)
  })
  return result
}
/** Trusted SQL expression only. JSON paths and table names are frozen, never request strings. */
export function workspaceProofIsCurrent(proof: string): string {
  return (['boards', 'projects', 'tasks'] as const)
    .map((kind) => {
      const table =
        kind === 'boards' ? 'task_boards' : kind === 'projects' ? 'task_projects' : 'review_tasks'
      return `NOT EXISTS(SELECT 1 FROM json_each(${proof},'$.${kind}') w LEFT JOIN ${table} r ON r.id=json_extract(w.value,'$.id')
      WHERE r.id IS NULL OR r.updated_at IS NOT json_extract(w.value,'$.updated')${kind === 'tasks' ? '' : " OR COALESCE(r.membership_revision,0) IS NOT json_extract(w.value,'$.revision')"})`
    })
    .join(' AND ')
}
