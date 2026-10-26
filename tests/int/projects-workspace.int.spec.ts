import { createChapterUser, fixtureOperator } from '../helpers/native-authority'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { boardRole, canTask, internalWorkspace } from '@/review/workspace-access'
import { workspaceEndpoints } from '@/review/workspace-endpoints'
import { projectSharingEndpoints } from '@/review/project-sharing'
import { taskFields } from '@/review/workspace-fields'
import { workspaceFormula, workspaceReferences } from '@/review/workspace-formula'
import { workspaceFileEndpoints } from '@/review/workspace-files'
import { workspaceEndpoint } from '@/review/workspace-service'
import { crmTaskInternalReadAllowed } from '@/crm/task-where'
import { projectBoardSummaries } from '@/review/project-board-service'

describe('Projects workspace: inherited access, fields, scheduling, and time', () => {
  let payload: Payload, project: number, board: number, privateBoard: number, task: number
  const users: User[] = []
  const req = (index: number) =>
    createLocalReq({ user: { ...users[index], collection: 'users' } }, payload)
  const endpoint = async (
    index: number,
    path: string,
    method: string,
    body?: Record<string, unknown>,
    params: Record<string, string> = {},
  ) => {
    const handler = workspaceEndpoints.find(
        (endpoint) => endpoint.path === path && endpoint.method === method,
      )!.handler,
      request = await req(index)
    request.routeParams = params
    Object.defineProperty(request, 'url', {
      value: 'http://localhost/api/test',
      configurable: true,
    })
    request.json = async () => body
    return handler(request)
  }
  beforeAll(async () => {
    payload = await getPayload({ config })
    const suffix = Date.now()
    for (let i = 0; i < 5; i++)
      users.push(
        i === 4
          ? await fixtureOperator(payload)
          : await createChapterUser(payload, 'editor', {
              collection: 'users',
              data: {
                username: `project-${suffix}-${i}`,
                email: `project-${suffix}-${i}@example.invalid`,
                password: 'local-project-password',
                role: i === 4 ? 'administrator' : 'editor',
              },
            }),
      )
    project = (
      await payload.create({
        collection: 'task-projects',
        req: await req(0),
        overrideAccess: false,
        data: { name: 'Private work', visibility: 'private' },
      })
    ).id
    board = (
      await payload.create({
        collection: 'task-boards',
        req: await req(0),
        overrideAccess: false,
        data: {
          name: 'Inherited board',
          project,
          inheritProject: true,
          owner: users[0].id,
          visibility: 'private',
        },
      })
    ).id
    privateBoard = (
      await payload.create({
        collection: 'task-boards',
        req: await req(1),
        overrideAccess: false,
        data: { name: 'Private exception', owner: users[1].id, visibility: 'private' },
      })
    ).id
    task = (
      await payload.create({
        collection: 'review-tasks',
        req: await req(0),
        overrideAccess: false,
        data: { title: 'Project task', initialBoard: board, status: 'open', priority: 'normal' },
      })
    ).id
  })
  it('counts project tasks through the private CRM bridge without exposing its query scope', async () => {
    const request = await req(0)
    request.routeParams = { id: String(project) }
    const handler = workspaceEndpoints.find(
      (item) => item.path === '/task-workspace/projects/:id/counts',
    )!.handler
    const response = await handler(request)
    expect(await response.json()).toEqual({ boards: 1, tasks: 1 })
    expect(crmTaskInternalReadAllowed(request)).toBe(false)
    await expect(
      payload.count({
        collection: 'review-tasks',
        req: request,
        overrideAccess: false,
        where: { 'crmContext.site': { equals: 'default' } },
      }),
    ).rejects.toThrow(/cannot be queried/)
    await expect(
      endpoint(1, '/task-workspace/projects/:id/counts', 'get', undefined, {
        id: String(project),
      }),
    ).rejects.toThrow(/unavailable/)
  })
  it('inherits viewer/editor roles in SQL reads and native counts', async () => {
    expect(await canTask(await req(1), task)).toBe(false)
    const member = await payload.create({
      collection: 'task-project-memberships',
      req: await req(0),
      overrideAccess: false,
      data: { project, user: users[1].id, role: 'viewer' },
    })
    expect(await boardRole(await req(1), board)).toBe('viewer')
    expect(await canTask(await req(1), task)).toBe(true)
    expect(await canTask(await req(1), task, 'edit')).toBe(false)
    expect(
      (
        await payload.count({
          collection: 'review-tasks',
          req: await req(1),
          overrideAccess: false,
          where: { id: { equals: task } },
        })
      ).totalDocs,
    ).toBe(1)
    await payload.update({
      collection: 'task-project-memberships',
      id: member.id,
      req: await req(0),
      overrideAccess: false,
      data: { role: 'editor', expectedUpdatedAt: member.updatedAt },
    })
    expect(await boardRole(await req(1), board)).toBe('editor')
    expect(await canTask(await req(1), task, 'edit')).toBe(true)
  })
  it('summarizes project boards without exposing private exceptions or caller query authority', async () => {
    const privateException = await payload.create({
      collection: 'task-boards',
      req: await req(1),
      overrideAccess: false,
      data: {
        name: 'Hidden summary exception',
        owner: users[1].id,
        project,
        inheritProject: false,
        visibility: 'private',
      },
    })
    const request = await req(0)
    const result = await projectBoardSummaries(request, project)
    expect(result.docs.map((item) => item.id)).toContain(board)
    expect(result.docs.map((item) => item.id)).not.toContain(privateException.id)
    expect(result.docs.find((item) => item.id === board)?.counts).toEqual({
      all: 1,
      overdue: 0,
      upcoming: 0,
      completed: 0,
    })
    expect(crmTaskInternalReadAllowed(request)).toBe(false)
    expect(internalWorkspace(request)).toBe(false)
    await expect(projectBoardSummaries(await req(2), project)).rejects.toThrow(/unavailable/)
  })
  it('keeps nested server-write authority off the caller request', async () => {
    const request = await req(0)
    const created = await payload.create({
      collection: 'review-tasks',
      req: request,
      overrideAccess: false,
      data: { title: 'Scoped authority', initialBoard: board, status: 'open', priority: 'normal' },
    })
    expect(internalWorkspace(request)).toBe(false)
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: created.id,
        req: request,
        overrideAccess: false,
        data: { boards: [privateBoard], expectedUpdatedAt: created.updatedAt },
      }),
    ).rejects.toThrow()
    expect(internalWorkspace(request)).toBe(false)
  })
  it('keeps private exceptions hidden from project owners and rejects forged inheritance', async () => {
    await expect(
      payload.update({
        collection: 'task-boards',
        id: privateBoard,
        req: await req(1),
        overrideAccess: false,
        data: { project, inheritProject: false },
      }),
    ).rejects.toThrow()
    expect(await boardRole(await req(0), privateBoard)).toBeNull()
    expect(
      (
        await payload.count({
          collection: 'task-boards',
          req: await req(0),
          overrideAccess: false,
          where: { id: { equals: privateBoard } },
        })
      ).totalDocs,
    ).toBe(0)
  })
  it('creates default views and isolates personal view preferences', async () => {
    const views = await payload.find({
      collection: 'task-views',
      req: await req(1),
      overrideAccess: false,
      where: { board: { equals: board } },
    })
    expect(views.docs.map((view) => view.kind).sort()).toEqual(
      ['overview', 'list', 'board', 'gantt', 'calendar', 'files'].sort(),
    )
    await expect(
      payload.create({
        collection: 'task-views',
        req: await req(1),
        overrideAccess: false,
        data: { board, name: 'Unauthorized', kind: 'list' },
      }),
    ).rejects.toThrow()
    await payload.create({
      collection: 'task-board-preferences',
      req: await req(1),
      overrideAccess: false,
      data: { board, user: users[0].id, key: 'forged', view: 'timeline' },
    })
    expect(
      (
        await payload.count({
          collection: 'task-board-preferences',
          req: await req(0),
          overrideAccess: false,
          where: { board: { equals: board } },
        })
      ).totalDocs,
    ).toBe(0)
  })
  it('stores typed shared values, rejects stale writes, and preserves values after removing columns', async () => {
    const field = await payload.create({
      collection: 'task-field-definitions',
      req: await req(0),
      overrideAccess: false,
      data: { name: 'Effort', kind: 'number' },
    })
    const attachment = await payload.create({
      collection: 'task-board-fields',
      req: await req(0),
      overrideAccess: false,
      data: { board, field: field.id },
    })
    const current = await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })
    const saved = await endpoint(
      1,
      '/task-workspace/tasks/:id',
      'post',
      { action: 'field', field: field.id, value: 7, expectedUpdatedAt: current.updatedAt },
      { id: String(task) },
    )
    expect(saved.ok).toBe(true)
    expect(
      (await taskFields(await req(1), task)).find((value) => value.definition.id === field.id)
        ?.value,
    ).toBe(7)
    await expect(
      endpoint(
        1,
        '/task-workspace/tasks/:id',
        'post',
        { action: 'field', field: field.id, value: 9, expectedUpdatedAt: current.updatedAt },
        { id: String(task) },
      ),
    ).rejects.toThrow()
    await payload.delete({
      collection: 'task-board-fields',
      id: attachment.id,
      req: await req(0),
      overrideAccess: false,
    })
    expect(
      (await taskFields(await req(1), task)).some((value) => value.definition.id === field.id),
    ).toBe(false)
    await payload.create({
      collection: 'task-board-fields',
      req: await req(0),
      overrideAccess: false,
      data: { board, field: field.id },
    })
    expect(
      (await taskFields(await req(1), task)).find((value) => value.definition.id === field.id)
        ?.value,
    ).toBe(7)
    await expect(
      payload.update({
        collection: 'task-field-definitions',
        id: field.id,
        req: await req(0),
        overrideAccess: false,
        data: { kind: 'text', expectedUpdatedAt: field.updatedAt },
      }),
    ).rejects.toThrow()
  })
  const makeField = async (kind: string, configuration: object = {}) => {
    const definition = await payload.create({
      collection: 'task-field-definitions',
      req: await req(0),
      overrideAccess: false,
      data: { name: `Verify ${kind}`, kind, configuration } as never,
    })
    await payload.create({
      collection: 'task-board-fields',
      req: await req(0),
      overrideAccess: false,
      data: { board, field: definition.id },
    })
    return definition
  }
  it.each(['single-select', 'multi-select', 'text', 'date', 'people'] as const)(
    'persists the shared %s field through the native editor',
    async (kind) => {
      const options = {
        options: [
          { id: 'first', label: 'First', color: '#3498db' },
          { id: 'second', label: 'Second', color: '#e67e22' },
        ],
      }
      const values = {
        'single-select': 'first',
        'multi-select': ['first', 'second'],
        text: 'Shared note',
        date: '2026-10-20',
        people: [users[2].id],
      }
      const value = values[kind],
        definition = await makeField(kind, kind.endsWith('select') ? options : {}),
        current = await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })
      await endpoint(
        0,
        '/task-workspace/tasks/:id',
        'post',
        { action: 'field', field: definition.id, value, expectedUpdatedAt: current.updatedAt },
        { id: String(task) },
      )
      expect(
        (await taskFields(await req(1), task)).find((item) => item.definition.id === definition.id)
          ?.value,
      ).toEqual(value)
    },
  )
  it('derives identifiers and time tracking and rejects forged computed values', async () => {
    const identifier = await makeField('id', { prefix: 'TASK-' }),
      tracking = await makeField('time-tracking')
    const result = await taskFields(await req(1), task)
    expect(String(result.find((item) => item.definition.id === identifier.id)?.value)).toContain(
      String(task),
    )
    expect(result.find((item) => item.definition.id === tracking.id)?.value).toBe(0)
    await expect(
      endpoint(
        1,
        '/task-workspace/tasks/:id',
        'post',
        {
          action: 'field',
          field: identifier.id,
          value: 'forged',
          expectedUpdatedAt: (await payload.findByID({ collection: 'review-tasks', id: task }))
            .updatedAt,
        },
        { id: String(task) },
      ),
    ).rejects.toThrow()
  })
  it('starts a shared countdown and returns its remaining time', async () => {
    const timer = await makeField('timer')
    await endpoint(
      1,
      '/task-workspace/tasks/:id',
      'post',
      { action: 'countdown', field: timer.id, seconds: 60, running: true },
      { id: String(task) },
    )
    const remaining = (await taskFields(await req(1), task)).find(
      (item) => item.definition.id === timer.id,
    )?.value
    expect(Number(remaining)).toBeGreaterThan(0)
  })
  it('duplicates rich board pages and changes the default view atomically', async () => {
    const view = await payload.create({
      collection: 'task-views',
      req: await req(0),
      overrideAccess: false,
      data: { board, name: 'Plan', kind: 'page' },
    })
    const body = {
      root: {
        type: 'root',
        version: 1,
        direction: 'ltr',
        format: '',
        indent: 0,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              {
                type: 'text',
                version: 1,
                text: 'Retain this plan',
                format: 0,
                mode: 'normal',
                style: '',
                detail: 0,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
          },
        ],
      },
    }
    await payload.create({
      collection: 'task-board-pages',
      req: await req(0),
      overrideAccess: false,
      data: { board, view: view.id, body } as never,
    })
    await endpoint(
      0,
      '/task-workspace/views/:id',
      'post',
      { action: 'duplicate', expectedUpdatedAt: view.updatedAt },
      { id: String(view.id) },
    )
    const copy = (
      await payload.find({
        collection: 'task-views',
        req: await req(0),
        overrideAccess: false,
        where: { and: [{ board: { equals: board } }, { name: { equals: 'Plan copy' } }] },
      })
    ).docs[0]
    expect(copy).toBeTruthy()
    expect(
      (
        await payload.find({
          collection: 'task-board-pages',
          req: await req(0),
          overrideAccess: false,
          where: { view: { equals: copy.id } },
        })
      ).docs[0].body,
    ).toEqual(body)
    await endpoint(
      0,
      '/task-workspace/views/:id',
      'post',
      { action: 'default', expectedUpdatedAt: copy.updatedAt },
      { id: String(copy.id) },
    )
    expect(
      (
        await payload.count({
          collection: 'task-views',
          req: await req(0),
          overrideAccess: false,
          where: { and: [{ board: { equals: board } }, { defaultView: { equals: true } }] },
        })
      ).totalDocs,
    ).toBe(1)
  })
  it('rejects a due date before the start date', async () => {
    const current = await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: await req(1),
        overrideAccess: false,
        data: {
          startDate: '2026-10-22T12:00:00Z',
          dueDate: '2026-10-20T12:00:00Z',
          expectedUpdatedAt: current.updatedAt,
        },
      }),
    ).rejects.toThrow()
  })
  it('creates tasks idempotently and rejects reuse for different input', async () => {
    const body = {
      title: 'Safe retry task',
      initialBoard: board,
      clientRequestKey: crypto.randomUUID(),
    }
    const first = (await (await endpoint(0, '/task-workspace/create', 'post', body)).json()) as any
    const retry = (await (await endpoint(0, '/task-workspace/create', 'post', body)).json()) as any
    expect(retry.doc.id).toBe(first.doc.id)
    await expect(
      endpoint(0, '/task-workspace/create', 'post', { ...body, title: 'Different task' }),
    ).rejects.toThrow('different task')
    const concurrent = { ...body, title: 'Concurrent retry', clientRequestKey: crypto.randomUUID() }
    const results = await Promise.all([
      endpoint(0, '/task-workspace/create', 'post', concurrent),
      endpoint(0, '/task-workspace/create', 'post', concurrent),
    ])
    const docs = (await Promise.all(results.map((response) => response.json()))) as any[]
    expect(docs[0].doc.id).toBe(docs[1].doc.id)
  })
  it('supports standalone-board dependencies and rejects their cycles', async () => {
    const standalone = await payload.create({
      collection: 'task-boards',
      req: await req(0),
      overrideAccess: false,
      data: { name: 'Standalone dependency board', owner: users[0].id, visibility: 'private' },
    })
    const a = await payload.create({
      collection: 'review-tasks',
      req: await req(0),
      overrideAccess: false,
      data: {
        title: 'First standalone',
        initialBoard: standalone.id,
        status: 'open',
        priority: 'normal',
      },
    })
    const b = await payload.create({
      collection: 'review-tasks',
      req: await req(0),
      overrideAccess: false,
      data: {
        title: 'Second standalone',
        initialBoard: standalone.id,
        status: 'open',
        priority: 'normal',
      },
    })
    await endpoint(
      0,
      '/task-workspace/tasks/:id',
      'post',
      { action: 'dependency', predecessor: a.id, expectedUpdatedAt: b.updatedAt },
      { id: String(b.id) },
    )
    const detail = (await (
      await endpoint(0, '/task-workspace/tasks/:id', 'get', undefined, { id: String(b.id) })
    ).json()) as any
    expect(detail.dependencies.some((item: any) => item.task === a.id)).toBe(true)
    await expect(
      endpoint(
        0,
        '/task-workspace/tasks/:id',
        'post',
        { action: 'dependency', predecessor: b.id, expectedUpdatedAt: a.updatedAt },
        { id: String(a.id) },
      ),
    ).rejects.toThrow()
    const current = await payload.findByID({ collection: 'review-tasks', id: b.id })
    await endpoint(
      0,
      '/task-workspace/tasks/:id',
      'post',
      {
        action: 'remove-dependency',
        dependency: detail.dependencies[0].id,
        expectedUpdatedAt: current.updatedAt,
      },
      { id: String(b.id) },
    )
  })
  it('rejects dependency cycles without automatic rescheduling', async () => {
    const current = await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })
    const second = await payload.create({
      collection: 'review-tasks',
      req: await req(1),
      overrideAccess: false,
      data: { title: 'Second', initialBoard: board, status: 'open', priority: 'normal' },
    })
    await endpoint(
      1,
      '/task-workspace/tasks/:id',
      'post',
      { action: 'dependency', predecessor: second.id, expectedUpdatedAt: current.updatedAt },
      { id: String(task) },
    )
    await expect(
      endpoint(
        1,
        '/task-workspace/tasks/:id',
        'post',
        { action: 'dependency', predecessor: task, expectedUpdatedAt: second.updatedAt },
        { id: String(second.id) },
      ),
    ).rejects.toThrow()
    expect(
      (await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })).dueDate,
    ).toBeFalsy()
  })
  it('supports safe text/date formulas and rejects executable expressions', () => {
    expect(
      workspaceFormula('concat(upper([f1]), " / ", round([f2] / 2, 1))', { f1: 'effort', f2: 7 }),
    ).toBe('EFFORT / 3.5')
    expect(workspaceFormula('days("2026-03-07", "2026-03-09")', {})).toBe(2)
    expect(workspaceFormula('if([f2] > 3, "Large", "Small")', { f2: 7 })).toBe('Large')
    expect(() => workspaceReferences('fetch("https://example.com")')).toThrow()
    expect(() => workspaceFormula('[f99] * 2', {})).toThrow()
  })
  it('enforces one active timer and keeps other readers’ detailed entries private', async () => {
    await endpoint(
      1,
      '/task-workspace/tasks/:id',
      'post',
      { action: 'start-time' },
      { id: String(task) },
    )
    await expect(
      endpoint(
        1,
        '/task-workspace/tasks/:id',
        'post',
        { action: 'start-time' },
        { id: String(task) },
      ),
    ).rejects.toThrow()
    const mine: any = await (
      await endpoint(1, '/task-workspace/tasks/:id', 'get', undefined, { id: String(task) })
    ).json()
    expect(mine.time.entries).toHaveLength(1)
    const entry = mine.time.entries[0]
    await endpoint(
      1,
      '/task-workspace/tasks/:id',
      'post',
      { action: 'stop-time', entry: entry.id, expectedUpdatedAt: entry.updatedAt },
      { id: String(task) },
    )
    await payload.create({
      collection: 'task-project-memberships',
      req: await req(0),
      overrideAccess: false,
      data: { project, user: users[2].id, role: 'viewer' },
    })
    const other: any = await (
      await endpoint(2, '/task-workspace/tasks/:id', 'get', undefined, { id: String(task) })
    ).json()
    expect(other.time.entries).toHaveLength(0)
  })
  it('protects uploaded bytes and denies both metadata APIs and revoked downloads', async () => {
    const objects = new Map<string, Uint8Array>()
    const storage = {
      put: async (key: string, value: Uint8Array) => {
        objects.set(key, value)
        return {}
      },
      get: async (key: string) => {
        const value = objects.get(key)
        return value ? { body: new Blob([value]).stream(), size: value.length } : null
      },
      delete: async (key: string) => {
        objects.delete(key)
      },
    } as unknown as R2Bucket
    const endpoints = workspaceFileEndpoints(storage),
      invoke = async (
        index: number,
        path: string,
        method: string,
        body?: unknown,
        id?: number,
        bytes?: Uint8Array,
      ) => {
        const request = await req(index)
        request.routeParams = { id: String(id ?? '') }
        request.json = async () => body
        if (bytes) Object.defineProperty(request, 'body', { value: new Blob([bytes]).stream() })
        return endpoints
          .find((endpoint) => endpoint.path === path && endpoint.method === method)!
          .handler(request)
      }
    const fileTask = await payload.create({
      collection: 'review-tasks',
      req: await req(0),
      overrideAccess: false,
      data: { title: 'Private file', initialBoard: board, status: 'open', priority: 'normal' },
    })
    const bytes = new TextEncoder().encode('Private project notes'),
      staged: any = await (
        await invoke(1, '/task-workspace/files/stage', 'post', {
          task: fileTask.id,
          filename: 'notes.txt',
          size: bytes.length,
        })
      ).json()
    expect(
      (await invoke(1, '/task-workspace/files/:id/content', 'put', undefined, staged.id, bytes)).ok,
    ).toBe(true)
    await expect(
      payload.find({ collection: 'task-attachments', req: await req(2), overrideAccess: false }),
    ).rejects.toThrow()
    const download = await invoke(
      2,
      '/task-workspace/files/:id/content',
      'get',
      undefined,
      staged.id,
    )
    expect(await download.text()).toBe('Private project notes')
    expect(download.headers.get('cache-control')).toBe('private, no-store')
    await expect(
      invoke(3, '/task-workspace/files/:id/content', 'get', undefined, staged.id),
    ).rejects.toThrow()
    await expect(
      invoke(1, '/task-workspace/files/stage', 'post', {
        task: fileTask.id,
        filename: 'script.html',
        size: 20,
      }),
    ).rejects.toThrow()
  })
  it('redacts restricted references and lookups, while preserving permitted values', async () => {
    const target = await payload.create({
      collection: 'review-tasks',
      req: await req(1),
      overrideAccess: false,
      data: {
        title: 'Restricted reference target',
        initialBoard: privateBoard,
        status: 'open',
        priority: 'normal',
      },
    })
    const reference = await payload.create({
      collection: 'task-field-definitions',
      req: await req(0),
      overrideAccess: false,
      data: { name: 'Related work', kind: 'reference' },
    })
    const lookup = await payload.create({
      collection: 'task-field-definitions',
      req: await req(0),
      overrideAccess: false,
      data: {
        name: 'Related title',
        kind: 'lookup',
        configuration: { referenceField: reference.id, property: 'title' },
      },
    })
    for (const field of [reference, lookup])
      await payload.create({
        collection: 'task-board-fields',
        req: await req(0),
        overrideAccess: false,
        data: { board, field: field.id },
      })
    const current = await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })
    await endpoint(
      1,
      '/task-workspace/tasks/:id',
      'post',
      {
        action: 'field',
        field: reference.id,
        value: [{ collection: 'review-tasks', id: target.id }],
        expectedUpdatedAt: current.updatedAt,
      },
      { id: String(task) },
    )
    const visible = await taskFields(await req(1), task),
      redacted = await taskFields(await req(2), task)
    expect(visible.find((field) => field.definition.id === lookup.id)?.value).toEqual([
      'Restricted reference target',
    ])
    expect(redacted.find((field) => field.definition.id === lookup.id)?.value).toBeNull()
    expect(redacted.find((field) => field.definition.id === reference.id)?.value).toBeNull()
    expect(JSON.stringify(redacted)).not.toContain('Restricted reference target')
  })
  it('protects reused field definitions and rejects overlapping manual time atomically', async () => {
    const definition = await payload.create({
      collection: 'task-field-definitions',
      req: await req(0),
      overrideAccess: false,
      data: {
        name: 'Reusable category',
        kind: 'single-select',
        configuration: { options: [{ id: 'health', label: 'Health', color: '#ff00ff' }] },
      },
    })
    await payload.create({
      collection: 'task-board-fields',
      req: await req(1),
      overrideAccess: false,
      data: { board: privateBoard, field: definition.id },
    })
    await expect(
      payload.update({
        collection: 'task-field-definitions',
        id: definition.id,
        req: await req(0),
        overrideAccess: false,
        data: { name: 'Changed', expectedUpdatedAt: definition.updatedAt },
      }),
    ).rejects.toThrow()
    await payload.update({
      collection: 'task-field-definitions',
      id: definition.id,
      req: await req(4),
      overrideAccess: false,
      data: { name: 'Approved shared category', expectedUpdatedAt: definition.updatedAt },
    })
    const body = {
      action: 'save-time',
      startedAt: '2026-01-12T13:00:00.000Z',
      endedAt: '2026-01-12T14:00:00.000Z',
      note: 'Concurrent entry',
    }
    const results = await Promise.allSettled([
      endpoint(1, '/task-workspace/tasks/:id', 'post', body, { id: String(task) }),
      endpoint(1, '/task-workspace/tasks/:id', 'post', body, { id: String(task) }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })
  const changeProject = async (index: number, body: Record<string, unknown>) => {
    const request = await req(index)
    request.json = async () => body
    return projectSharingEndpoints[0].handler(request)
  }
  it('retains a shared task across the source and destination board audiences', async () => {
    await payload.create({
      collection: 'task-board-memberships',
      req: await req(1),
      overrideAccess: false,
      data: { board: privateBoard, user: users[0].id, role: 'editor', key: 'server-derived' },
    })
    const shared = await payload.create({
      collection: 'review-tasks',
      req: await req(0),
      overrideAccess: false,
      data: {
        title: 'Audience-controlled work',
        initialBoard: board,
        status: 'open',
        priority: 'normal',
      },
    })
    const actionRequest = await req(0)
    actionRequest.routeParams = { id: String(shared.id) }
    actionRequest.json = async () => ({ action: 'share', board: privateBoard, confirm: true })
    expect((await workspaceEndpoint.handler(actionRequest)).ok).toBe(true)
  })
  it('requires all shared-board owners and rejects approval after membership edits', async () => {
    const pending = (await (
      await changeProject(1, {
        action: 'request',
        board: privateBoard,
        project,
        inheritProject: true,
        confirm: true,
      })
    ).json()) as { pending: boolean; id: number }
    expect(pending.pending).toBe(true)
    expect(Number.isSafeInteger(pending.id)).toBe(true)
    const member = (
      await payload.find({
        collection: 'task-project-memberships',
        depth: 0,
        where: { and: [{ project: { equals: project } }, { user: { equals: users[2].id } }] },
      })
    ).docs[0]
    await payload.update({
      collection: 'task-project-memberships',
      id: member.id,
      req: await req(0),
      overrideAccess: false,
      data: { role: 'commenter', expectedUpdatedAt: member.updatedAt },
    })
    await expect(changeProject(0, { action: 'approve', request: pending.id })).rejects.toThrow()
  })
  it('applies renewed project sharing approval from a different source owner', async () => {
    const renewed = (await (
      await changeProject(1, {
        action: 'request',
        board: privateBoard,
        project,
        inheritProject: true,
        confirm: true,
      })
    ).json()) as { id: number }
    expect((await changeProject(0, { action: 'approve', request: renewed.id })).ok).toBe(true)
    expect(
      (await payload.findByID({ collection: 'task-boards', id: privateBoard, depth: 0 }))
        .inheritProject,
    ).toBe(true)
  })
  it('revokes inherited access immediately and respects project archival', async () => {
    let record = await payload.findByID({ collection: 'task-projects', id: project, depth: 0 })
    await payload.update({
      collection: 'task-projects',
      id: project,
      req: await req(0),
      overrideAccess: false,
      data: { archived: true, expectedUpdatedAt: record.updatedAt },
    })
    expect(await canTask(await req(1), task)).toBe(true)
    expect(await canTask(await req(1), task, 'edit')).toBe(false)
    record = await payload.findByID({ collection: 'task-projects', id: project, depth: 0 })
    await payload.update({
      collection: 'task-projects',
      id: project,
      req: await req(0),
      overrideAccess: false,
      data: { archived: false, expectedUpdatedAt: record.updatedAt },
    })
    const member = await payload.find({
      collection: 'task-project-memberships',
      depth: 0,
      where: { and: [{ project: { equals: project } }, { user: { equals: users[1].id } }] },
    })
    await payload.delete({
      collection: 'task-project-memberships',
      id: member.docs[0].id,
      req: await req(0),
      overrideAccess: false,
    })
    expect(await canTask(await req(1), task)).toBe(false)
  })
})
