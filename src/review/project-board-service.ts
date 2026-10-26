import type { PayloadRequest, Where } from 'payload'
import { requireProject } from './project-access'
import { workspaceReq } from './workspace-access'
import { crmTaskInternalRead, crmTaskWhere } from '../crm/task-where'
import { siteCalendarDay } from './workspace-dates'
import { countBoardTask, type ProjectBoardSummary } from './project-board-model'

/** Projects do not grant access to private board exceptions or restricted CRM tasks. */
export async function projectBoardSummaries(req: PayloadRequest, project: number) {
  await requireProject(req, project)
  const settings = await req.payload.findGlobal({
    slug: 'site-settings',
    req,
    depth: 0,
    overrideAccess: true,
  })
  const timezone = settings.timezone || 'UTC'
  const today = siteCalendarDay(new Date(), timezone)
  const docs: ProjectBoardSummary[] = []
  const queryReq = workspaceReq({
    ...req,
    query: { ...req.query },
    context: {
      ...req.context,
      crmQueryScope: 'project-board-summary',
      [crmTaskInternalRead]: true,
    },
  } as PayloadRequest)
  let page = 1
  let pages = 1
  do {
    const boards = await req.payload.find({
      collection: 'task-boards',
      req,
      overrideAccess: false,
      depth: 0,
      page,
      limit: 100,
      sort: 'name',
      where: { and: [{ project: { equals: project } }, { archived: { not_equals: true } }] },
    })
    pages = boards.totalPages
    for (const board of boards.docs) {
      const counts = { overdue: 0, upcoming: 0, completed: 0, all: 0 }
      // Board access was verified by the native list above. Keep the CRM predicate
      // on the exact board, avoiding a second expansion of the workspace ACL joins.
      const scope = crmTaskWhere(req, 'read', '', { boards: { equals: board.id } })
      let taskPage = 1
      let taskPages = 1
      do {
        const tasks = await req.payload.find({
          collection: 'review-tasks',
          req: queryReq,
          overrideAccess: true,
          depth: 0,
          page: taskPage,
          limit: 100,
          sort: 'id',
          select: { status: true, dueDate: true },
          where: {
            and: [
              scope === true ? {} : scope || { id: { equals: -1 } },
              { parent: { exists: false } },
              { archived: { not_equals: true } },
            ],
          } as Where,
        })
        for (const task of tasks.docs) countBoardTask(counts, task, today)
        taskPages = tasks.totalPages
        taskPage++
      } while (taskPage <= taskPages)
      docs.push({
        id: board.id,
        name: board.name,
        description: board.description,
        inheritProject: board.inheritProject,
        counts,
      })
    }
    page++
  } while (page <= pages)
  return { docs, today, timezone }
}
