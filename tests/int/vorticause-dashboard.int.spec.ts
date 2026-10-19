import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { activeBoards, activeProjects } from '@/dashboard/workspace-model'

describe('VortiCause Dashboard authorized workspace queries', () => {
  let payload: Payload
  const users: User[] = [],
    projects: number[] = [],
    boards: number[] = []
  const req = (index = 0) =>
    createLocalReq({ user: { ...users[index], collection: 'users' } }, payload)
  beforeAll(async () => {
    payload = await getPayload({ config })
    for (let i = 0; i < 2; i++)
      users.push(
        await payload.create({
          collection: 'users',
          data: {
            username: `dash-${Date.now()}-${i}`,
            email: `dash-${Date.now()}-${i}@example.invalid`,
            password: 'dashboard-check-password',
            role: 'editor',
          },
        }),
      )
    for (let i = 0; i < 9; i++) {
      const project = await payload.create({
        collection: 'task-projects',
        req: await req(),
        overrideAccess: false,
        data: { name: `Dashboard ${i}`, visibility: 'private' },
      })
      projects.push(project.id)
      const board = await payload.create({
        collection: 'task-boards',
        req: await req(),
        overrideAccess: false,
        data: {
          name: `Board ${i}`,
          project: project.id,
          inheritProject: false,
          visibility: 'private',
          owner: users[0].id,
        },
      })
      boards.push(board.id)
    }
    const project = await payload.findByID({ collection: 'task-projects', id: projects[1] })
    await payload.update({
      collection: 'task-projects',
      id: project.id,
      req: await req(),
      overrideAccess: false,
      data: { archived: true, expectedUpdatedAt: project.updatedAt },
    })
    const board = await payload.findByID({ collection: 'task-boards', id: boards[2] })
    await payload.update({
      collection: 'task-boards',
      id: board.id,
      req: await req(),
      overrideAccess: false,
      data: { archived: true, expectedUpdatedAt: board.updatedAt },
    })
  }, 180000)
  it('counts all authorized active records independently of the six-row widgets', async () => {
    const projectCount = await payload.count({
      collection: 'task-projects',
      req: await req(),
      overrideAccess: false,
      where: activeProjects,
    })
    const boardCount = await payload.count({
      collection: 'task-boards',
      req: await req(),
      overrideAccess: false,
      where: activeBoards,
    })
    const recent = await payload.find({
      collection: 'task-boards',
      req: await req(),
      overrideAccess: false,
      where: activeBoards,
      limit: 6,
      depth: 0,
      sort: '-updatedAt,-id',
    })
    expect(projectCount.totalDocs).toBe(8)
    expect(boardCount.totalDocs).toBe(7)
    expect(recent.docs).toHaveLength(6)
    expect(recent.docs.every((doc) => doc.id !== boards[1] && doc.id !== boards[2])).toBe(true)
  })
  it('limits private-exception readers and favorites without granting project access', async () => {
    await payload.create({
      collection: 'task-board-memberships',
      req: await req(),
      overrideAccess: false,
      data: { board: boards[0], user: users[1].id, role: 'viewer', key: 'server' },
    })
    expect(
      (
        await payload.count({
          collection: 'task-projects',
          req: await req(1),
          overrideAccess: false,
          where: activeProjects,
        })
      ).totalDocs,
    ).toBe(0)
    expect(
      (
        await payload.count({
          collection: 'task-boards',
          req: await req(1),
          overrideAccess: false,
          where: activeBoards,
        })
      ).totalDocs,
    ).toBe(1)
    await expect(
      payload.findByID({
        collection: 'task-projects',
        id: projects[0],
        req: await req(1),
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    await payload.create({
      collection: 'task-board-preferences',
      req: await req(1),
      overrideAccess: false,
      data: {
        board: boards[0],
        user: users[1].id,
        key: 'server',
        favorite: true,
        iconColor: 'teal',
      },
    })
    const favorites = await payload.find({
      collection: 'task-boards',
      req: await req(1),
      overrideAccess: false,
      depth: 0,
      where: { and: [activeBoards, { 'preferences.favoriteUser': { equals: users[1].id } }] },
    })
    expect(favorites.docs.map((doc) => doc.id)).toEqual([boards[0]])
  })
})
