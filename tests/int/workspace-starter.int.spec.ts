import { createChapterUser } from '../helpers/native-authority'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { initializeStarterWorkspace } from '@/review/workspace-starter'
import { workspaceDB, workspaceReq } from '@/review/workspace-access'
import { workspaceEndpoints } from '@/review/workspace-endpoints'
import type { User } from '@/payload-types'

describe('per-user starter workspace', () => {
  let payload: Payload
  let users: User[]
  const request = (index = 0) =>
    createLocalReq({ user: { ...users[index], collection: 'users' } }, payload)
  const records = async (index = 0) => {
    const req = await request(index)
    const options = { req: workspaceReq(req), overrideAccess: true, depth: 0, limit: 100 }
    return {
      projects: (
        await payload.find({
          ...options,
          collection: 'task-projects',
          where: { owner: { equals: users[index].id } },
        })
      ).docs,
      boards: (
        await payload.find({
          ...options,
          collection: 'task-boards',
          where: { owner: { equals: users[index].id } },
        })
      ).docs,
    }
  }
  beforeAll(async () => {
    payload = await getPayload({ config })
    users = []
    for (let i = 0; i < 4; i++)
      users.push(
        await createChapterUser(payload, 'editor', {
          collection: 'users',
          data: {
            username: `starter-${Date.now()}-${i}`,
            email: `starter-${Date.now()}-${i}@example.invalid`,
            password: 'starter-test-password',
            role: 'editor',
          },
        }),
      )
  })
  it('initializes existing accounts once under concurrent requests, privately with full board defaults', async () => {
    const login = await payload.login({
      collection: 'users',
      data: {
        username: users[0].username!,
        password: 'starter-test-password',
      },
    })
    await payload.create({
      collection: 'task-projects',
      req: await request(),
      overrideAccess: false,
      data: { name: 'Existing work', visibility: 'private' },
    })
    await Promise.all(
      Array.from({ length: 4 }, async () => initializeStarterWorkspace(await request())),
    )
    expect(
      (await payload.auth({ headers: new Headers({ Authorization: `Bearer ${login.token}` }) }))
        .user?.id,
    ).toBe(users[0].id)
    const { projects, boards } = await records()
    expect(projects.map((p) => p.name).sort()).toEqual(['Existing work', 'Work'])
    expect(boards).toHaveLength(1)
    expect(boards[0]).toMatchObject({
      name: "Personal To-Do's",
      inheritProject: true,
      visibility: 'private',
      owner: users[0].id,
    })
    expect(projects.find((p) => p.name === 'Work')).toMatchObject({
      visibility: 'private',
      owner: users[0].id,
    })
    const views = await payload.find({
      collection: 'task-views',
      overrideAccess: true,
      depth: 0,
      where: { board: { equals: boards[0].id } },
    })
    expect(views.docs.map((v) => v.kind).sort()).toEqual([
      'board',
      'calendar',
      'files',
      'gantt',
      'list',
      'overview',
    ])
    expect(
      (
        await payload.count({
          collection: 'task-board-fields',
          overrideAccess: true,
          where: { board: { equals: boards[0].id } },
        })
      ).totalDocs,
    ).toBe(1)
    expect(
      (
        await payload.count({
          collection: 'task-boards',
          req: await request(1),
          overrideAccess: false,
        })
      ).totalDocs,
    ).toBe(0)
    expect(
      (await payload.findByID({ collection: 'users', id: users[0].id, overrideAccess: true }))
        .workspaceInitialized,
    ).toBe(true)
  })
  it('resumes after project creation fails before the board is created', async () => {
    const original = payload.create.bind(payload)
    const spy = vi.spyOn(payload, 'create').mockImplementation((async (args: any) => {
      if (args.collection === 'task-boards') throw new Error('Interrupted board creation')
      return original(args)
    }) as typeof payload.create)
    try {
      await expect(initializeStarterWorkspace(await request(1))).rejects.toThrow('Interrupted')
    } finally {
      spy.mockRestore()
    }
    expect((await records(1)).projects).toHaveLength(1)
    expect((await records(1)).boards).toHaveLength(0)
    expect(
      (await payload.findByID({ collection: 'users', id: users[1].id, overrideAccess: true }))
        .workspaceInitialized,
    ).toBe(false)
    await initializeStarterWorkspace(await request(1))
    expect((await records(1)).projects).toHaveLength(1)
    expect((await records(1)).boards).toHaveLength(1)
  })
  it('repairs interrupted board defaults before marking completion', async () => {
    const req = await request(2),
      db = workspaceDB(req)
    const project = await payload.create({
      collection: 'task-projects',
      req: workspaceReq(req),
      overrideAccess: true,
      data: { name: 'Work', visibility: 'private', starterKey: `work:${users[2].id}` },
    })
    const board = await payload.create({
      collection: 'task-boards',
      req: workspaceReq(req),
      overrideAccess: true,
      data: {
        name: "Personal To-Do's",
        owner: users[2].id,
        project: project.id,
        visibility: 'private',
        inheritProject: true,
        starterKey: `personal-todos:${users[2].id}`,
      },
    })
    // Simulate a previously interrupted initialization with incomplete defaults.
    await db
      .prepare("DELETE FROM task_views WHERE board_id=? AND kind IN ('calendar','files')")
      .bind(board.id)
      .run()
    await db.prepare('DELETE FROM task_board_fields WHERE board_id=?').bind(board.id).run()
    expect(
      (await payload.findByID({ collection: 'users', id: users[2].id, overrideAccess: true }))
        .workspaceInitialized,
    ).toBe(false)
    const before = await records(2)
    expect(before.boards).toHaveLength(1)
    await initializeStarterWorkspace(await request(2))
    expect((await records(2)).boards[0].id).toBe(before.boards[0].id)
    expect(
      (
        await payload.count({
          collection: 'task-views',
          overrideAccess: true,
          where: { board: { equals: before.boards[0].id } },
        })
      ).totalDocs,
    ).toBe(6)
  })
  it('does not recreate archived or renamed starter records, or removed views', async () => {
    const { projects, boards } = await records()
    const project = projects.find((p) => p.name === 'Work')!
    const view = (
      await payload.find({
        collection: 'task-views',
        overrideAccess: true,
        where: { board: { equals: boards[0].id } },
      })
    ).docs[0]
    await payload.delete({
      collection: 'task-views',
      id: view.id,
      req: await request(),
      overrideAccess: false,
    })
    await payload.update({
      collection: 'task-projects',
      id: project.id,
      req: await request(),
      overrideAccess: false,
      data: { archived: true, name: 'Renamed work', expectedUpdatedAt: project.updatedAt },
    })
    await payload.update({
      collection: 'task-boards',
      id: boards[0].id,
      req: await request(),
      overrideAccess: false,
      data: { archived: true, name: 'Renamed board', expectedUpdatedAt: boards[0].updatedAt },
    })
    await initializeStarterWorkspace(await request())
    expect((await records()).boards).toHaveLength(1)
    expect((await records()).boards[0]).toMatchObject({ archived: true, name: 'Renamed board' })
    expect((await records()).projects.find((p) => p.id === project.id)).toMatchObject({
      archived: true,
      name: 'Renamed work',
    })
    expect(
      (
        await payload.count({
          collection: 'task-views',
          overrideAccess: true,
          where: { board: { equals: boards[0].id } },
        })
      ).totalDocs,
    ).toBe(5)
  })
  it('ignores client-authored initialization fields and scopes the endpoint to its signed-in account', async () => {
    await payload.update({
      collection: 'users',
      id: users[3].id,
      req: await request(3),
      overrideAccess: false,
      data: { workspaceInitialized: true },
    })
    expect(
      (await payload.findByID({ collection: 'users', id: users[3].id, overrideAccess: true }))
        .workspaceInitialized,
    ).toBe(false)
    const req = await request(3)
    req.json = async () => ({ user: users[0].id, workspaceInitialized: true })
    const endpoint = workspaceEndpoints.find((e) => e.path === '/task-workspace/initialize')!
    expect((await endpoint.handler(req)).status).toBe(200)
    const { projects, boards } = await records(3)
    expect(projects).toHaveLength(1)
    expect(boards).toHaveLength(1)
    await payload.update({
      collection: 'users',
      id: users[3].id,
      req: await request(3),
      overrideAccess: false,
      data: { workspaceInitialized: false, displayName: 'Updated account' },
    })
    expect(
      (await payload.findByID({ collection: 'users', id: users[3].id, overrideAccess: true }))
        .workspaceInitialized,
    ).toBe(true)
    const edited = await payload.update({
      collection: 'task-projects',
      id: projects[0].id,
      req: await request(3),
      overrideAccess: false,
      data: { starterKey: 'forged', expectedUpdatedAt: projects[0].updatedAt },
    })
    expect(edited).not.toHaveProperty('starterKey')
    expect(
      (
        await payload.findByID({
          collection: 'task-projects',
          id: projects[0].id,
          overrideAccess: true,
        })
      ).starterKey,
    ).toBe(`work:${users[3].id}`)
    const anonymous = await createLocalReq({}, payload)
    await expect(endpoint.handler(anonymous)).rejects.toMatchObject({ status: 401 })
  })
})
