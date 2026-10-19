import { workspaceReq } from './workspace-access'
import { initializeStarterWorkspace } from './workspace-starter'
import type { Endpoint, PayloadRequest } from 'payload'
import { relationID } from './documents'
import {
  reject,
  requireBoard,
  requireTask,
  workspaceDB,
  ensureWorkspaceGuards,
  taskWhere,
  boardWhere,
} from './workspace-access'
import { taskFields, validateFieldValue, fieldEvaluation } from './workspace-fields'
import { workspaceFormula, workspaceReferences } from './workspace-formula'
import { nativeFormulaValue } from './formula-inputs'
import { mutateTime, timeSummary } from './workspace-time'
import { fileList } from './workspace-files'
import { requireProject } from './project-access'
import { taskSearchTerms } from './client'
import { userIdentity } from '@design-system/payload-design-core'

export async function boardTasks(req: PayloadRequest, board: number) {
  await requireBoard(req, board)
  const access = taskWhere(req)
  const docs = []
  let page = 1,
    totalPages = 1
  do {
    const result = await req.payload.find({
      collection: 'review-tasks',
      req,
      overrideAccess: true,
      depth: 0,
      limit: 100,
      page,
      select: { id: true, startDate: true, dueDate: true, milestone: true },
      where: {
        and: [
          { boards: { equals: board } },
          { archived: { not_equals: true } },
          ...(access === true ? [] : [access || { id: { equals: -1 } }]),
        ],
      },
      sort: 'createdAt',
    })
    docs.push(...result.docs)
    totalPages = result.totalPages
    page++
  } while (page <= totalPages)
  return docs
}
async function dependencies(req: PayloadRequest, taskID: number) {
  const result = await req.payload.find({
    collection: 'task-dependencies',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 100,
    where: { task: { equals: taskID } },
  })
  const docs = []
  for (const dependency of result.docs) {
    try {
      const target = await requireTask(req, dependency.predecessor)
      docs.push({
        id: dependency.id,
        task: target.id,
        title: target.title,
        dueDate: target.dueDate,
        status: target.status,
      })
    } catch {
      docs.push({ id: dependency.id, unavailable: true })
    }
  }
  return docs
}
export const workspaceEndpoints: Endpoint[] = [
  {
    path: '/task-workspace/initialize',
    method: 'post',
    handler: async (req) => {
      await initializeStarterWorkspace(req)
      return Response.json({ initialized: true })
    },
  },
  {
    path: '/task-workspace/people',
    method: 'get',
    handler: async (req) => {
      if (!req.user) reject('Sign in.', 401)
      const input = (new URL(req.url!).searchParams.get('ids') ?? '').split(',').filter(Boolean)
      if (input.length > 50 || input.some((id) => !/^\d+$/.test(id)))
        reject('Choose up to 50 existing people.', 400)
      if (!input.length) return Response.json({ docs: [] })
      const result = await req.payload.find({
        collection: 'users',
        req,
        overrideAccess: true,
        depth: 0,
        limit: 50,
        where: { id: { in: input } },
      })
      return Response.json({
        docs: result.docs.map((user) => ({ id: user.id, label: userIdentity(user) })),
      })
    },
  },
  {
    path: '/task-workspace/tasks/:id/time',
    method: 'get',
    handler: async (req) => {
      const params = new URL(req.url!).searchParams,
        week = params.get('week') ?? undefined
      if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) reject('Choose a valid week.', 400)
      return Response.json(
        await timeSummary(req, Number(req.routeParams?.id), false, {
          week,
          page: Math.max(1, Number(params.get('page') ?? 1)),
        }),
      )
    },
  },
  {
    path: '/task-workspace/views/:id',
    method: 'post',
    handler: async (req) => {
      const view = await req.payload.findByID({
          collection: 'task-views',
          id: String(req.routeParams?.id),
          req,
          overrideAccess: false,
          depth: 0,
        }),
        body = (await req.json!()) as Record<string, unknown>
      await requireBoard(req, view.board, 'owner')
      await requireBoard(req, view.board, 'edit')
      if (body.expectedUpdatedAt !== view.updatedAt)
        reject('This view changed. Reload before saving.', 409)
      if (!['default', 'duplicate'].includes(String(body.action)))
        reject('Unsupported view action.', 400)
      const db = workspaceDB(req),
        guard = crypto.randomUUID(),
        now = new Date().toISOString()
      await ensureWorkspaceGuards(req)
      const statements = [
        db
          .prepare(
            'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM task_views WHERE id=? AND updated_at=?) THEN 1 ELSE 0 END)',
          )
          .bind(guard, view.id, view.updatedAt),
      ]
      if (body.action === 'default')
        statements.push(
          db
            .prepare(
              'UPDATE task_views SET default_view=CASE WHEN id=? THEN 1 ELSE 0 END,updated_at=? WHERE board_id=?',
            )
            .bind(view.id, now, Number(relationID(view.board))),
        )
      else
        statements.push(
          db
            .prepare(
              "INSERT INTO task_views(board_id,name,kind,position,default_view,configuration,updated_at,created_at) SELECT board_id,substr(name,1,70)||' copy',kind,(SELECT coalesce(max(position),0)+1 FROM task_views WHERE board_id=v.board_id),0,configuration,?,? FROM task_views v WHERE id=?",
            )
            .bind(now, now, view.id),
          db
            .prepare(
              'INSERT INTO task_board_pages(board_id,view_id,body,key,updated_at,created_at) SELECT board_id,last_insert_rowid(),body,CAST(last_insert_rowid() AS TEXT),?,? FROM task_board_pages WHERE view_id=?',
            )
            .bind(now, now, view.id),
        )
      statements.push(db.prepare('DELETE FROM task_workspace_guards WHERE id=?').bind(guard))
      try {
        await db.batch(statements)
      } catch {
        reject('This view changed. Reload before saving.', 409)
      }
      return Response.json({ saved: true })
    },
  },
  {
    path: '/task-workspace/projects',
    method: 'get',
    handler: async (req) => {
      if (!req.user) reject('Sign in.', 401)
      const params = new URL(req.url!).searchParams,
        page = Math.max(1, Number(params.get('page') ?? 1))
      const result = await req.payload.find({
        collection: 'task-projects',
        req: workspaceReq(req),
        overrideAccess: false,
        depth: 0,
        limit: 20,
        page,
        sort: 'name',
        where: {
          and: [
            { archived: { equals: params.get('archived') === 'true' } },
            ...taskSearchTerms(params.get('search') ?? '').map((term) => ({
              name: { contains: term },
            })),
            ...(params.get('favorites') === 'true'
              ? [
                  { 'projectPreferences.user': { equals: req.user!.id } },
                  { 'projectPreferences.favorite': { equals: true } },
                ]
              : []),
          ],
        },
      })
      return Response.json(result)
    },
  },
  {
    path: '/task-workspace/projects/:id/counts',
    method: 'get',
    handler: async (req) => {
      const id = Number(req.routeParams?.id)
      await requireProject(req, id)
      const access = taskWhere(req),
        boards = await req.payload.count({
          collection: 'task-boards',
          req,
          overrideAccess: false,
          where: { project: { equals: id } },
        }),
        tasks = await req.payload.count({
          collection: 'review-tasks',
          req,
          overrideAccess: true,
          where: {
            and: [
              { 'boards.project': { equals: id } },
              { archived: { not_equals: true } },
              { status: { not_equals: 'done' } },
              ...(access === true ? [] : [access || { id: { equals: -1 } }]),
              ...(req.user?.role === 'administrator' ? [] : [boardWhere(req, 'read', 'boards.')]),
            ],
          },
        })
      return Response.json({ boards: boards.totalDocs, tasks: tasks.totalDocs })
    },
  },
  {
    path: '/task-workspace/formula-preview',
    method: 'post',
    handler: async (req) => {
      const body = (await req.json!()) as { task: number; expression: string }
      const task = await requireTask(req, body.task)
      const fields = await taskFields(req, body.task),
        values: Record<string, unknown> = {}
      try {
        for (const reference of workspaceReferences(body.expression)) {
          if (reference.startsWith('n')) { values[reference] = nativeFormulaValue(task as unknown as Record<string,unknown>, reference); continue }
          const result = fields.find((field) => `f${field.definition.id}` === reference)
          if (!result || result.error) reject('A formula input is unavailable.', 400)
          values[reference] = result.value
        }
        return Response.json({ value: workspaceFormula(body.expression, values) })
      } catch (error) {
        reject((error as Error).message, 400)
      }
    },
  },
  {
    path: '/task-workspace/tasks/:id',
    method: 'get',
    handler: async (req) => {
      const id = Number(req.routeParams?.id)
      await requireTask(req, id)
      const [fields, time, links, files, countdowns] = await Promise.all([
        taskFields(req, id),
        timeSummary(req, id),
        dependencies(req, id),
        fileList(req, { task: id }),
        req.payload.find({
          collection: 'task-countdowns',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 50,
          where: { and: [{ task: { equals: id } }, { user: { equals: req.user!.id } }] },
        }),
      ])
      return Response.json({
        fields,
        time,
        dependencies: links,
        files,
        countdowns: countdowns.docs,
      })
    },
  },
  {
    path: '/task-workspace/tasks/:id',
    method: 'post',
    handler: async (req) => {
      const id = Number(req.routeParams?.id),
        body = (await req.json!()) as Record<string, any>,
        task = await requireTask(req, id)
      if (['start-time', 'stop-time', 'switch-time', 'save-time'].includes(body.action))
        return Response.json(await mutateTime(req, id, body))
      if (body.action === 'countdown') {
        const fields = await taskFields(req, id)
        if (!fields.some((f) => f.definition.id === body.field && f.definition.kind === 'timer'))
          reject('Timer field is unavailable.', 400)
        if (!Number.isInteger(body.seconds) || body.seconds < 0 || body.seconds > 604800)
          reject('Countdown must be between zero and seven days.', 400)
        const key = `${id}:${req.user!.id}:${body.field}`
        const result = await req.payload.find({
          collection: 'task-countdowns',
          req,
          overrideAccess: true,
          depth: 0,
          limit: 1,
          where: { key: { equals: key } },
        })
        const data = {
          task: id,
          user: req.user!.id,
          field: body.field,
          key,
          remainingSeconds: body.seconds,
          endsAt: body.running ? new Date(Date.now() + body.seconds * 1000).toISOString() : null,
        }
        const doc = result.docs[0]
          ? await req.payload.update({
              collection: 'task-countdowns',
              id: result.docs[0].id,
              req,
              overrideAccess: true,
              data,
            })
          : await req.payload.create({
              collection: 'task-countdowns',
              req,
              overrideAccess: true,
              data,
            })
        return Response.json(doc)
      }
      await requireTask(req, id, 'edit')
      if (body.expectedUpdatedAt !== task.updatedAt)
        reject('This task changed. Reload before saving.', 409)
      if (body.action === 'field') {
        const available = await taskFields(req, id),
          field = available.find((item) => item.definition.id === body.field)
        if (!field) reject('This field is unavailable on your boards.', 403)
        const value = await validateFieldValue(req, field!.definition, body.value, field!.value),
          now = new Date().toISOString(),
          db = workspaceDB(req),
          guard = crypto.randomUUID()
        await ensureWorkspaceGuards(req)
        try {
          await db.batch([
            db
              .prepare(
                'INSERT INTO task_workspace_guards(id,valid) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM review_tasks WHERE id=? AND updated_at=?) THEN 1 ELSE 0 END)',
              )
              .bind(guard, id, task.updatedAt),
            db
              .prepare(
                'INSERT INTO task_field_values(task_id,field_id,key,value,updated_at,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
              )
              .bind(id, body.field, `${id}:${body.field}`, JSON.stringify(value), now, now),
            db.prepare('UPDATE review_tasks SET updated_at=? WHERE id=?').bind(now, id),
            db.prepare('DELETE FROM task_workspace_guards WHERE id=?').bind(guard),
          ])
        } catch {
          reject('This task changed. Reload before saving.', 409)
        }
        return Response.json({ fields: await taskFields(req, id), updatedAt: now })
      }
      if (body.action === 'dependency') {
        const predecessor = await requireTask(req, body.predecessor)
        if (predecessor.id === id) reject('A task cannot depend on itself.', 400)
        const sourceProjects = new Set<string>(),
          targetProjects = new Set<string>()
        for (const board of task.boards ?? []) {
          const doc = await req.payload.findByID({
            collection: 'task-boards',
            id: relationID(board),
            req,
            overrideAccess: false,
            depth: 0,
          })
          if (doc.project) sourceProjects.add(relationID(doc.project))
        }
        for (const board of predecessor.boards ?? []) {
          try {
            const doc = await req.payload.findByID({
              collection: 'task-boards',
              id: relationID(board),
              req,
              overrideAccess: false,
              depth: 0,
            })
            if (doc.project) targetProjects.add(relationID(doc.project))
          } catch {}
        }
        const project = [...sourceProjects].find((value) => targetProjects.has(value))
        if (!project) reject('Dependencies require accessible tasks in the same project.', 400)
        const db = workspaceDB(req),
          guard = crypto.randomUUID(),
          now = new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString()
        await ensureWorkspaceGuards(req)
        try {
          await db.batch([
            db
              .prepare(
                'INSERT INTO task_workspace_guards(id,valid) SELECT ?,CASE WHEN NOT EXISTS(WITH RECURSIVE chain(id) AS (SELECT predecessor_id FROM task_dependencies WHERE task_id=? UNION SELECT d.predecessor_id FROM task_dependencies d JOIN chain c ON d.task_id=c.id) SELECT 1 FROM chain WHERE id=?) AND EXISTS(SELECT 1 FROM review_tasks WHERE id=? AND updated_at=?) THEN 1 ELSE 0 END',
              )
              .bind(guard, predecessor.id, id, id, body.expectedUpdatedAt),
            db
              .prepare(
                'INSERT INTO task_dependencies(task_id,predecessor_id,project_id,key,updated_at,created_at) VALUES(?,?,?,?,?,?)',
              )
              .bind(id, predecessor.id, Number(project), `${id}:${predecessor.id}`, now, now),
            db.prepare('UPDATE review_tasks SET updated_at=? WHERE id=?').bind(now, id),
            db.prepare('DELETE FROM task_workspace_guards WHERE id=?').bind(guard),
          ])
        } catch {
          reject(
            'Dependency changed, already exists, or would create a cycle. Reload before retrying.',
            409,
          )
        }
        return Response.json({ created: true, updatedAt: now })
      }
      if (body.action === 'remove-dependency') {
        const doc = await req.payload.findByID({
          collection: 'task-dependencies',
          id: body.dependency,
          req,
          overrideAccess: true,
          depth: 0,
        })
        if (relationID(doc.task) !== String(id)) reject('Dependency is unavailable.')
        await req.payload.delete({
          collection: 'task-dependencies',
          id: doc.id,
          req,
          overrideAccess: true,
        })
        return Response.json({ deleted: true })
      }
      reject('Unsupported task action.', 400)
    },
  },
  {
    path: '/task-workspace/boards/:id/report',
    method: 'get',
    handler: async (req) => {
      const board = Number(req.routeParams?.id)
      await requireBoard(req, board)
      const params = new URL(req.url!).searchParams,
        page = Math.max(1, Number(params.get('page') ?? 1)),
        result = await req.payload.find({
          collection: 'review-tasks',
          req,
          overrideAccess: false,
          depth: 0,
          limit: 20,
          page,
          where: { and: [{ boards: { equals: board } }, { archived: { not_equals: true } }] },
          sort: 'createdAt',
        }),
        tasks = result.docs,
        counts: Record<string, number> = {},
        assignees: Record<string, { tasks: number; seconds: number }> = {},
        today = new URL(req.url!).searchParams.get('today')
      const safeToday = /^\d{4}-\d{2}-\d{2}$/.test(today ?? '')
        ? today!
        : new Date().toISOString().slice(0, 10)
      let overdue = 0,
        seconds = 0
      const settings = await req.payload.findGlobal({
          slug: 'site-settings',
          req,
          overrideAccess: true,
          depth: 0,
        }),
        evaluation = fieldEvaluation()
      const enriched = []
      for (const task of tasks) {
        counts[task.status] = (counts[task.status] ?? 0) + 1
        if (task.status !== 'done' && task.dueDate && task.dueDate.slice(0, 10) < safeToday)
          overdue++
        const time = await timeSummary(req, task.id, false, {
          task,
          timezone: settings.timezone ?? 'UTC',
          totalsOnly: true,
        })
        seconds += time.seconds
        const key = relationID(task.assignee) || 'unassigned'
        assignees[key] ??= { tasks: 0, seconds: 0 }
        assignees[key].tasks++
        assignees[key].seconds += time.seconds
        enriched.push({
          ...task,
          fields: await taskFields(req, task.id, task, evaluation),
          time,
          dependencies: await dependencies(req, task.id),
        })
      }
      return Response.json({
        counts,
        overdue,
        seconds,
        assignees,
        tasks: enriched,
        timezone: settings.timezone ?? 'UTC',
        page: result.page,
        totalDocs: result.totalDocs,
        totalPages: result.totalPages,
      })
    },
  },
  {
    path: '/task-workspace/boards/:id/baseline',
    method: 'post',
    handler: async (req) => {
      const board = Number(req.routeParams?.id)
      await requireBoard(req, board, 'owner')
      await requireBoard(req, board, 'edit')
      const body = (await req.json!()) as Record<string, any>,
        tasks = await boardTasks(req, board)
      const doc = await req.payload.create({
        collection: 'task-baselines',
        req: workspaceReq(req),
        overrideAccess: true,
        data: {
          board,
          name: String(body.name ?? 'Baseline').slice(0, 120),
          snapshot: tasks.map((task) => ({
            id: task.id,
            startDate: task.startDate,
            dueDate: task.dueDate,
            milestone: task.milestone,
          })),
        },
      })
      return Response.json({ id: doc.id })
    },
  },
  {
    path: '/task-workspace/boards/:id/baselines/:baseline',
    method: 'get',
    handler: async (req) => {
      const board = Number(req.routeParams?.id)
      await requireBoard(req, board)
      const doc = await req.payload.findByID({
        collection: 'task-baselines',
        id: String(req.routeParams?.baseline),
        req,
        overrideAccess: true,
        depth: 0,
      })
      if (relationID(doc.board) !== String(board)) reject('Baseline unavailable.', 404)
      const snapshot = []
      for (const item of (doc.snapshot ?? []) as { id: number }[]) {
        try {
          await requireTask(req, item.id)
          snapshot.push(item)
        } catch {}
      }
      return Response.json({ id: doc.id, name: doc.name, snapshot })
    },
  },
  {
    path: '/task-workspace/references',
    method: 'get',
    handler: async (req) => {
      if (!req.user) reject('Sign in.', 401)
      const params = new URL(req.url!).searchParams,
        collection = params.get('collection') ?? 'review-tasks',
        terms = taskSearchTerms(params.get('search') ?? '')
      if (!['review-tasks', 'task-boards', 'task-projects', 'posts', 'pages'].includes(collection))
        reject('Unsupported reference collection.', 400)
      const field = ['review-tasks', 'posts', 'pages'].includes(collection) ? 'title' : 'name'
      const docs = await req.payload.find({
        collection: collection as 'review-tasks',
        req,
        overrideAccess: false,
        depth: 0,
        limit: 30,
        where: terms.length ? { and: terms.map((term) => ({ [field]: { contains: term } })) } : {},
      })
      return Response.json({
        docs: docs.docs.map((doc) => ({
          id: doc.id,
          label: (doc as unknown as Record<string, unknown>)[field],
          collection,
        })),
      })
    },
  },
]
