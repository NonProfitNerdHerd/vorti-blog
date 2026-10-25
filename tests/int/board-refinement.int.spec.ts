import { createChapterUser } from '../helpers/native-authority'
import { beforeAll, describe, it, expect } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { taskFields, validateFieldValue } from '@/review/workspace-fields'
describe('board completion, colors, grouped creation and formulas', () => {
  let payload: Payload, board: number
  const users: User[] = []
  const req = (i = 0) => createLocalReq({ user: { ...users[i], collection: 'users' } }, payload)
  beforeAll(async () => {
    payload = await getPayload({ config })
    for (let i = 0; i < 2; i++)
      users.push(
        await createChapterUser(payload, 'editor', {
          collection: 'users',
          data: {
            username: `refine-${Date.now()}-${i}`,
            email: `refine-${Date.now()}-${i}@example.invalid`,
            password: 'refine-test-password',
            role: 'editor',
          },
        }),
      )
    board = (
      await payload.create({
        collection: 'task-boards',
        req: await req(),
        overrideAccess: false,
        data: { name: 'Refinement', owner: users[0].id, visibility: 'private' },
      })
    ).id
    await payload.create({
      collection: 'task-board-memberships',
      req: await req(),
      overrideAccess: false,
      data: { board, user: users[1].id, role: 'viewer', key: 'server' },
    })
  })
  it('creates a default Timeline without replacing the default List', async () => {
    const views = await payload.find({
      collection: 'task-views',
      req: await req(),
      overrideAccess: false,
      where: { board: { equals: board } },
    })
    expect(views.docs).toHaveLength(6)
    expect(views.docs.find((v) => v.name === 'Timeline')?.kind).toBe('gantt')
    expect(views.docs.find((v) => v.defaultView)?.kind).toBe('list')
  })
  it('derives completion timestamps, preserves them on edits, and clears on reopening', async () => {
    const task = await payload.create({
      collection: 'review-tasks',
      req: await req(),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Complete me',
        initialBoard: board,
        status: 'done',
        priority: 'normal',
        completedAt: '2000-01-01T00:00:00Z',
      },
    })
    expect(task.completedAt).toBeTruthy()
    expect(task.completedAt).not.toContain('2000-01-01')
    const edited = await payload.update({
      collection: 'review-tasks',
      id: task.id,
      req: await req(),
      overrideAccess: false,
      data: {
        title: 'Updated',
        expectedUpdatedAt: task.updatedAt,
        completedAt: '2000-01-01T00:00:00Z',
      },
    })
    expect(edited.completedAt).toBe(task.completedAt)
    const reopened = await payload.update({
      collection: 'review-tasks',
      id: task.id,
      req: await req(),
      overrideAccess: false,
      data: { status: 'open', expectedUpdatedAt: edited.updatedAt },
    })
    expect(reopened.completedAt).toBeNull()
  })
  it('allows owner-managed shared colors and rejects viewers and invalid color values', async () => {
    let doc = await payload.findByID({ collection: 'task-boards', id: board, depth: 0 })
    doc = await payload.update({
      collection: 'task-boards',
      id: board,
      req: await req(),
      overrideAccess: false,
      data: {
        presentation: { priorityColors: { high: '#ff0000' } },
        expectedUpdatedAt: doc.updatedAt,
      },
    })
    expect(doc.presentation).toEqual({ priorityColors: { high: '#ff0000' } })
    await expect(
      payload.update({
        collection: 'task-boards',
        id: board,
        req: await req(1),
        overrideAccess: false,
        data: {
          presentation: { priorityColors: { high: '#000000' } },
          expectedUpdatedAt: doc.updatedAt,
        },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'task-boards',
        id: board,
        req: await req(),
        overrideAccess: false,
        data: {
          presentation: { priorityColors: { high: 'javascript:invalid' } },
          expectedUpdatedAt: doc.updatedAt,
        },
      }),
    ).rejects.toThrow()
  })
  it('initializes multi-select groups and evaluates native/custom formula inputs with the same permissions', async () => {
    const category = await payload.create({
      collection: 'task-field-definitions',
      req: await req(),
      overrideAccess: false,
      data: {
        name: 'Category',
        kind: 'multi-select',
        configuration: {
          options: [
            { id: 'a', label: 'A', color: '#2563eb' },
            { id: 'b', label: 'B' },
          ],
        },
      },
    })
    await payload.create({
      collection: 'task-board-fields',
      req: await req(),
      overrideAccess: false,
      data: { board, field: category.id },
    })
    const formula = await payload.create({
      collection: 'task-field-definitions',
      req: await req(),
      overrideAccess: false,
      data: {
        name: 'Summary',
        kind: 'formula',
        configuration: { expression: `concat([ntitle]," ",join([f${category.id}],","))` },
      },
    })
    await payload.create({
      collection: 'task-board-fields',
      req: await req(),
      overrideAccess: false,
      data: { board, field: formula.id },
    })
    const task = await payload.create({
      collection: 'review-tasks',
      req: await req(),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Grouped',
        initialBoard: board,
        status: 'open',
        priority: 'normal',
        initialSelect: { field: category.id, value: ['a', 'b'] },
      },
    })
    expect(
      (await taskFields(await req(1), task.id)).find((f) => f.definition.id === formula.id)?.value,
    ).toBe('Grouped a,b')
    await expect(validateFieldValue(await req(),formula,null)).rejects.toThrow('computed')
    await expect(
      payload.create({
        collection: 'review-tasks',
        req: await req(1),
        overrideAccess: false,
        data: {
          title: 'Denied',
          initialBoard: board,
          status: 'open',
          priority: 'normal',
          initialSelect: { field: category.id, value: ['a'] },
        },
      }),
    ).rejects.toThrow()
  })
})
