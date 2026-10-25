import { createChapterUser } from '../helpers/native-authority'
import { taskFields } from '@/review/workspace-fields'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'

describe('compact workspace preferences and inline task creation', () => {
  let payload: Payload, board: number
  const users: User[] = []
  const req = (index = 0) =>
    createLocalReq({ user: { ...users[index], collection: 'users' } }, payload)
  beforeAll(async () => {
    payload = await getPayload({ config })
    for (let i = 0; i < 2; i++)
      users.push(
        await createChapterUser(payload, 'editor', {
          collection: 'users',
          data: {
            username: `compact-${Date.now()}-${i}`,
            email: `compact-${Date.now()}-${i}@example.invalid`,
            password: 'compact-test-password',
            role: 'editor',
          },
        }),
      )
    board = (
      await payload.create({
        collection: 'task-boards',
        req: await req(),
        overrideAccess: false,
        depth: 0,
        data: { name: 'Compact test', owner: users[0].id, visibility: 'private' },
      })
    ).id
    await payload.create({
      collection: 'task-board-memberships',
      req: await req(),
      overrideAccess: false,
      depth: 0,
      data: { board, user: users[1].id, role: 'viewer', key: 'derived' },
    })
  })
  it('allows a reader to save a personal color without changing other preferences or another account', async () => {
    const pref = await payload.create({
      collection: 'task-board-preferences',
      req: await req(1),
      overrideAccess: false,
      depth: 0,
      data: {
        board,
        user: users[0].id,
        key: 'forged',
        iconColor: 'pink',
        favorite: true,
        viewSettings: { test: { group: 'status' } },
      },
    })
    expect(pref.user).toBe(users[1].id)
    const updated = await payload.update({
      collection: 'task-board-preferences',
      id: pref.id,
      req: await req(1),
      overrideAccess: false,
      depth: 0,
      data: { iconColor: 'teal' },
    })
    expect(updated).toMatchObject({
      iconColor: 'teal',
      favorite: true,
      viewSettings: { test: { group: 'status' } },
    })
    await expect(
      payload.update({
        collection: 'task-board-preferences',
        id: pref.id,
        req: await req(),
        overrideAccess: false,
        depth: 0,
        data: { iconColor: 'red' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'task-board-preferences',
        id: pref.id,
        req: await req(1),
        overrideAccess: false,
        depth: 0,
        data: { iconColor: 'invalid' as never },
      }),
    ).rejects.toThrow()
  })
  it('creates parent and subtask inline using the existing API and inherited board audience', async () => {
    const parent = await payload.create({
      collection: 'review-tasks',
      req: await req(),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Inline parent',
        initialBoard: board,
        status: 'in-progress',
        priority: 'normal',
        assignee: users[0].id,
      },
    })
    const child = await payload.create({
      collection: 'review-tasks',
      req: await req(),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Inline child',
        parent: parent.id,
        status: 'open',
        priority: 'normal',
        assignee: null,
      },
    })
    expect(child).toMatchObject({
      status: 'open',
      priority: 'normal',
      assignee: null,
      parent: parent.id,
    })
    expect(child.boards).toContain(board)
    await expect(
      payload.create({
        collection: 'review-tasks',
        req: await req(1),
        overrideAccess: false,
        depth: 0,
        data: { title: 'Denied', initialBoard: board, status: 'open', priority: 'normal' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'review-tasks',
        req: await req(),
        overrideAccess: false,
        depth: 0,
        data: {
          title: 'Invalid select',
          status: 'open',
          priority: 'normal',
          initialBoard: board,
          initialSelect: { field: 999999, value: 'bad' },
        },
      }),
    ).rejects.toThrow()
  })
  it('initializes a grouped single-select value and rejects detached or retired options before creating a task', async () => {
    const definition = await payload.create({
      collection: 'task-field-definitions',
      req: await req(),
      overrideAccess: false,
      depth: 0,
      data: {
        name: 'Category',
        kind: 'single-select',
        configuration: {
          options: [
            { id: 'health', label: 'Health', color: '#15803d' },
            { id: 'old', label: 'Old', color: '#aaaaaa', retired: true },
          ],
        },
      },
    })
    await payload.create({
      collection: 'task-board-fields',
      req: await req(),
      overrideAccess: false,
      data: { board, field: definition.id },
    })
    const task = await payload.create({
      collection: 'review-tasks',
      req: await req(),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Grouped task',
        initialBoard: board,
        status: 'open',
        priority: 'normal',
        initialSelect: { field: definition.id, value: 'health' },
      },
    })
    expect(
      (await taskFields(await req(), task.id)).find(
        (value) => value.definition.id === definition.id,
      )?.value,
    ).toBe('health')
    const count = (await payload.count({ collection: 'review-tasks' })).totalDocs
    for (const selected of [
      { field: definition.id, value: 'old' },
      { field: definition.id, value: 'unknown' },
    ])
      await expect(
        payload.create({
          collection: 'review-tasks',
          req: await req(),
          overrideAccess: false,
          data: {
            title: 'Invalid group',
            initialBoard: board,
            status: 'open',
            priority: 'normal',
            initialSelect: selected,
          },
        }),
      ).rejects.toThrow()
    expect((await payload.count({ collection: 'review-tasks' })).totalDocs).toBe(count)
  })
  it('revoked readers cannot read or update their stored board color', async () => {
    const membership = (
      await payload.find({
        collection: 'task-board-memberships',
        req: await req(),
        overrideAccess: false,
        depth: 0,
        where: { board: { equals: board } },
      })
    ).docs[0]
    await payload.delete({
      collection: 'task-board-memberships',
      id: membership.id,
      req: await req(),
      overrideAccess: false,
      depth: 0,
    })
    const prefs = await payload.find({
      collection: 'task-board-preferences',
      req: await req(1),
      overrideAccess: false,
      depth: 0,
    })
    expect(prefs.totalDocs).toBe(0)
    await expect(
      payload.create({
        collection: 'task-board-preferences',
        req: await req(1),
        overrideAccess: false,
        depth: 0,
        data: { board, iconColor: 'blue', user: users[1].id, key: 'bad' },
      }),
    ).rejects.toThrow()
  })
})
