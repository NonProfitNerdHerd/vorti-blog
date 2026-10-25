import { createChapterUser, fixtureOperator } from '../helpers/native-authority'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import type { User } from '@/payload-types'
import config from '@/payload.config'
import { workspaceEndpoint } from '@/review/workspace-service'
import { canTask } from '@/review/workspace-access'
import {
  workspaceProjectionSchemaV1,
  workspaceProjectionBackfillV1,
} from '@/organizations/workspace-projection-v1'

const nativeIO = { timeout: 120000 }
describe('Task workspace access, multi-board sharing, and notifications', nativeIO, () => {
  let payload: Payload
  const users: User[] = []
  let board: number, second: number, task: number, child: number
  const req = async (index: number) =>
    createLocalReq({ user: { ...users[index], collection: 'users' } }, payload)
  const action = async (index: number, body: Record<string, unknown>) => {
    const request = await req(index)
    request.routeParams = { id: String(task) }
    request.json = async () => body
    return workspaceEndpoint.handler(request)
  }
  beforeAll(async () => {
    payload = await getPayload({ config })
    // Development schema push creates the derived table, but production access
    // uses its migration-installed projection triggers. Exercise that same ACL.
    const db = (payload.db as unknown as { client: D1Database }).client
    for (const statement of [...workspaceProjectionSchemaV1, ...workspaceProjectionBackfillV1])
      await db.prepare(statement).run()
    const suffix = Date.now()
    for (let i = 0; i < 6; i++)
      users.push(
        i === 5 ? await fixtureOperator(payload) : await createChapterUser(payload, 'editor', {
          collection: 'users',
          data: {
            username: `board-${suffix}-${i}`,
            email: `board-${suffix}-${i}@example.invalid`,
            password: 'local-workspace-password',
            role: i === 5 ? 'administrator' : 'editor',
          },
        }),
      )
  })
  it('denies a global editor without chapter workspace permission', async () => {
    const suffix = Date.now()
    const user = await payload.create({ collection: 'users', data: {
      username: `ungranted-${suffix}`, email: `ungranted-${suffix}@example.invalid`,
      password: 'local-ungranted-password', role: 'editor',
    } })
    await expect(payload.create({
      collection: 'task-boards', overrideAccess: false,
      req: await createLocalReq({ user: { ...user, collection: 'users' } }, payload),
      data: { name: 'Must be denied', visibility: 'private', owner: user.id },
    })).rejects.toThrow()
  })
  it('creates private boards, standalone tasks, and inherited subtasks', async () => {
    board = (
      await payload.create({
        collection: 'task-boards',
        req: await req(0),
        overrideAccess: false,
        data: { name: 'Private project', visibility: 'private', owner: users[0].id },
      })
    ).id
    second = (
      await payload.create({
        collection: 'task-boards',
        req: await req(1),
        overrideAccess: false,
        data: { name: 'Second project', visibility: 'private', owner: users[1].id },
      })
    ).id
    task = (
      await payload.create({
        collection: 'review-tasks',
        req: await req(0),
        overrideAccess: false,
        depth: 0,
        data: { title: 'Shared work', status: 'open', priority: 'normal' },
      })
    ).id
    expect(await canTask(await req(1), task)).toBe(false)
    expect((await action(0, { action: 'share', board, confirm: true })).ok).toBe(true)
    child = (
      await payload.create({
        collection: 'review-tasks',
        req: await req(0),
        overrideAccess: false,
        depth: 0,
        data: { title: 'Child work', parent: task, status: 'open', priority: 'normal' },
      })
    ).id
    const stored = await payload.findByID({ collection: 'review-tasks', id: child, depth: 0 })
    expect(stored.boards).toEqual([board])
  })
  it('filters native lists and counts without exposing private board tasks', async () => {
    const request = await req(1)
    const count = await payload.count({
      collection: 'review-tasks',
      req: request,
      overrideAccess: false,
      where: { id: { equals: task } },
    })
    expect(count.totalDocs).toBe(0)
    await expect(
      payload.findByID({
        collection: 'review-tasks',
        id: task,
        req: request,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    expect(
      (
        await payload.find({
          collection: 'task-boards',
          req: await req(1),
          overrideAccess: false,
          where: { id: { equals: board } },
        })
      ).totalDocs,
    ).toBe(0)
  })
  it('enforces viewer, commenter, and editor roles without trusting derived role fields', async () => {
    for (const [index, role] of [
      [1, 'editor'],
      [2, 'commenter'],
      [3, 'viewer'],
    ] as const)
      await payload.create({
        collection: 'task-board-memberships',
        req: await req(0),
        overrideAccess: false,
        data: { board, user: users[index].id, role, key: 'forged', editUser: users[4].id },
      })
    expect(await canTask(await req(1), task, 'edit')).toBe(true)
    expect(await canTask(await req(2), task, 'comment')).toBe(true)
    expect(await canTask(await req(2), task, 'edit')).toBe(false)
    expect(await canTask(await req(3), task)).toBe(true)
    expect(await canTask(await req(3), task, 'comment')).toBe(false)
    expect(await canTask(await req(4), task)).toBe(false)
    expect(
      (
        await payload.count({
          collection: 'task-notifications',
          req: await req(2),
          overrideAccess: false,
          where: { kind: { equals: 'invitation' } },
        })
      ).totalDocs,
    ).toBe(1)
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: await req(3),
        overrideAccess: false,
        data: { title: 'Forbidden' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'review-comments',
        req: await req(3),
        overrideAccess: false,
        data: { task, body: 'Forbidden' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'task-board-memberships',
        req: await req(1),
        overrideAccess: false,
        data: { board, user: users[4].id, role: 'editor', key: 'forged' },
      }),
    ).rejects.toThrow()
  })
  it('requires all source owners to approve sharing and shares the complete task tree', async () => {
    const pending = (await (
      await action(1, { action: 'share', board: second, confirm: true })
    ).json()) as { pending?: boolean }
    expect(pending.pending).toBe(true)
    const requests = await payload.find({
      collection: 'task-sharing-requests',
      depth: 0,
      where: { task: { equals: task } },
    })
    await action(0, { action: 'approve', request: requests.docs[0].id })
    expect(
      (await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })).boards,
    ).toEqual(expect.arrayContaining([board, second]))
    expect(
      (await payload.findByID({ collection: 'review-tasks', id: child, depth: 0 })).boards,
    ).toEqual(expect.arrayContaining([board, second]))
    const visible = await payload.findByID({
      collection: 'review-tasks',
      id: task,
      req: await req(0),
      overrideAccess: false,
      depth: 0,
    })
    expect(visible.boards).toEqual([board])
    const placements = await payload.find({
      collection: 'task-placements',
      req: await req(2),
      overrideAccess: false,
      depth: 0,
      where: { task: { equals: task } },
    })
    expect(placements.docs.map((p) => p.board)).toEqual([board])
    await expect(
      payload.find({
        collection: 'task-placements',
        req: await req(2),
        overrideAccess: false,
        where: { 'task.boards.directMemberships.user': { equals: users[2].id } },
      }),
    ).rejects.toThrow(/direct fields/)
  })
  it('rejects forged audience changes and stale task edits through native APIs', async () => {
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: await req(1),
        overrideAccess: false,
        data: { boards: [second] },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: await req(1),
        overrideAccess: false,
        data: { title: 'Stale', expectedUpdatedAt: '2000-01-01' },
      }),
    ).rejects.toThrow(/changed/)
    await expect(
      payload.create({
        collection: 'task-placements',
        req: await req(1),
        overrideAccess: false,
        data: { task, board: second, key: 'forged' },
      }),
    ).rejects.toThrow()
  })
  it('creates stable mention notifications and suppresses edits and self notifications', async () => {
    const body = `Please check @${users[2].username}`
    const comment = await payload.create({
      collection: 'review-comments',
      req: await req(1),
      overrideAccess: false,
      depth: 0,
      data: { task, body },
    })
    expect(comment.mentions).toEqual(
      expect.arrayContaining([expect.objectContaining({ user: users[2].id })]),
    )
    const where = {
      and: [
        { task: { equals: task } },
        { recipient: { equals: users[2].id } },
        { kind: { equals: 'mention' } },
      ],
    }
    expect(
      (
        await payload.count({
          collection: 'task-notifications',
          req: await req(2),
          overrideAccess: false,
          where,
        })
      ).totalDocs,
    ).toBe(1)
    await payload.update({
      collection: 'review-comments',
      id: comment.id,
      req: await req(1),
      overrideAccess: false,
      data: { body: body + ' please' },
    })
    expect(
      (
        await payload.count({
          collection: 'task-notifications',
          req: await req(2),
          overrideAccess: false,
          where,
        })
      ).totalDocs,
    ).toBe(1)
    await payload.update({
      collection: 'users',
      id: users[2].id,
      req: await req(2),
      overrideAccess: false,
      data: { username: `${users[2].username}-new` },
    })
    await payload.update({
      collection: 'review-comments',
      id: comment.id,
      req: await req(1),
      overrideAccess: false,
      data: { body: body + ' again' },
    })
    expect(
      (await payload.findByID({ collection: 'review-comments', id: comment.id })).mentions,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ user: users[2].id })]))
  })
  it('resolves mentions on the first save of board and personal tasks', async () => {
    const created = await payload.create({
      collection: 'review-tasks',
      req: await req(0),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Mention while creating',
        initialBoard: board,
        description: `Please start @${users[1].username}`,
        status: 'open',
        priority: 'normal',
      },
    })
    expect(created.boards).toEqual([board])
    expect(
      (
        await payload.count({
          collection: 'task-placements',
          req: await req(1),
          overrideAccess: false,
          where: { task: { equals: created.id } },
        })
      ).totalDocs,
    ).toBe(1)
    expect(
      (
        await payload.count({
          collection: 'task-notifications',
          req: await req(1),
          overrideAccess: false,
          where: { and: [{ task: { equals: created.id } }, { kind: { equals: 'mention' } }] },
        })
      ).totalDocs,
    ).toBe(1)
    const personal = await payload.create({
      collection: 'review-tasks',
      req: await req(0),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Personal first-save mention',
        assignee: users[1].id,
        description: `Please start @${users[1].username}`,
        status: 'open',
        priority: 'normal',
      },
    })
    expect(
      (
        await payload.count({
          collection: 'task-notifications',
          req: await req(1),
          overrideAccess: false,
          where: { task: { equals: personal.id } },
        })
      ).totalDocs,
    ).toBe(1)
    await expect(
      payload.create({
        collection: 'review-tasks',
        req: await req(3),
        overrideAccess: false,
        data: {
          title: 'Viewer cannot add',
          initialBoard: board,
          status: 'open',
          priority: 'normal',
        },
      }),
    ).rejects.toThrow()
  })
  it('invalidates sharing approval when destination membership changes', async () => {
    const destination = await payload.create({
      collection: 'task-boards',
      req: await req(1),
      overrideAccess: false,
      data: { name: 'Revision guarded', owner: users[1].id, visibility: 'private' },
    })
    await action(1, { action: 'share', board: destination.id, confirm: true })
    const pending = await payload.find({
      collection: 'task-sharing-requests',
      depth: 0,
      where: { and: [{ task: { equals: task } }, { destination: { equals: destination.id } }] },
    })
    await payload.create({
      collection: 'task-board-memberships',
      req: await req(1),
      overrideAccess: false,
      data: { board: destination.id, user: users[3].id, role: 'viewer', key: 'derived' },
    })
    await expect(action(0, { action: 'approve', request: pending.docs[0].id })).rejects.toThrow(
      /Membership changed/,
    )
    expect(
      (
        await payload.findByID({
          collection: 'task-sharing-requests',
          id: pending.docs[0].id,
          depth: 0,
        })
      ).state,
    ).toBe('stale')
    expect(
      (await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })).boards,
    ).not.toContain(destination.id)
  })
  it('moves cards within their board and rejects stale or cross-board moves', async () => {
    const section = await payload.create({
      collection: 'task-sections',
      req: await req(1),
      overrideAccess: false,
      data: { board, name: 'Publishing' },
    })
    const foreign = await payload.create({
      collection: 'task-sections',
      req: await req(1),
      overrideAccess: false,
      data: { board: second, name: 'Foreign' },
    })
    const current = (
      await payload.find({
        collection: 'task-placements',
        depth: 0,
        where: { key: { equals: `${task}:${board}` } },
      })
    ).docs[0]
    await expect(
      action(1, {
        action: 'move',
        board,
        section: foreign.id,
        expectedUpdatedAt: current.updatedAt,
      }),
    ).rejects.toThrow(/active section/)
    await action(1, {
      action: 'move',
      board,
      section: section.id,
      position: 2,
      expectedUpdatedAt: current.updatedAt,
    })
    await expect(
      action(1, { action: 'move', board, section: null, expectedUpdatedAt: current.updatedAt }),
    ).rejects.toThrow(/card moved/)
    const moved = await payload.findByID({
      collection: 'task-placements',
      id: current.id,
      depth: 0,
    })
    expect(moved.section).toBe(section.id)
  })
  it('allows team-wide viewing without granting editing and counts shared tasks once', async () => {
    const team = await payload.create({
      collection: 'task-boards',
      req: await req(4),
      overrideAccess: false,
      data: { name: 'Team board', owner: users[4].id, visibility: 'team' },
    })
    await action(5, { action: 'share', board: team.id, confirm: true })
    expect(await canTask(await req(4), task, 'edit')).toBe(true)
    const count = await payload.count({
      collection: 'review-tasks',
      req: await req(3),
      overrideAccess: false,
      where: { id: { equals: task } },
    })
    expect(count.totalDocs).toBe(1)
    expect(await canTask(await req(3), task, 'edit')).toBe(false)
    await action(4, { action: 'remove', board: team.id })
  })
  it('shares template work without sharing its restricted document reference', async () => {
    const template = await payload.create({
      collection: 'design-templates',
      req: await req(5),
      overrideAccess: false,
      data: {
        name: 'Restricted template',
        slug: `workspace-template-${Date.now()}`,
        status: 'draft',
        allowedCollections: ['pages'],
        layout: [],
      },
    })
    const linked = await payload.create({
      collection: 'review-tasks',
      req: await req(5),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Discuss protected template',
        documentType: 'design-templates',
        documentID: String(template.id),
        status: 'open',
        priority: 'normal',
      },
    })
    const request = await req(5)
    request.routeParams = { id: String(linked.id) }
    request.json = async () => ({ action: 'share', board, confirm: true })
    await workspaceEndpoint.handler(request)
    const read = (await payload.findByID({
      collection: 'review-tasks',
      id: linked.id,
      req: await req(1),
      overrideAccess: false,
      depth: 0,
    })) as unknown as {
      documentType?: string
      documentID?: string
      documentTitle?: string
      documentRestricted?: boolean
    }
    expect(read.documentRestricted).toBe(true)
    expect(read.documentType).toBeNull()
    expect(read.documentID).toBeNull()
    expect(read.documentTitle).toBeNull()
    await payload.update({
      collection: 'review-tasks',
      id: linked.id,
      req: await req(1),
      overrideAccess: false,
      data: { title: 'Collaborate without opening template' },
    })
  })
  it('revokes task and notification access immediately when membership is removed', async () => {
    const member = await payload.find({
      collection: 'task-board-memberships',
      depth: 0,
      where: { and: [{ board: { equals: board } }, { user: { equals: users[2].id } }] },
    })
    await payload.delete({
      collection: 'task-board-memberships',
      id: member.docs[0].id,
      req: await req(0),
      overrideAccess: false,
    })
    expect(await canTask(await req(2), task)).toBe(false)
    expect(
      (
        await payload.count({
          collection: 'task-notifications',
          req: await req(2),
          overrideAccess: false,
          where: { task: { equals: task } },
        })
      ).totalDocs,
    ).toBe(0)
  })
  it('retains the task when removing one placement and requires a decision for its last board', async () => {
    await action(0, { action: 'remove', board })
    expect(
      (await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })).boards,
    ).toEqual([second])
    await expect(action(1, { action: 'remove', board: second })).rejects.toThrow(/Choose Archive/)
    await action(1, { action: 'remove', board: second, lastAction: 'personal' })
    expect(
      (await payload.findByID({ collection: 'review-tasks', id: task, depth: 0 })).personal,
    ).toBe(true)
    expect(await canTask(await req(1), task)).toBe(false)
    expect(await canTask(await req(0), task)).toBe(true)
  })
  it('inherits personal parent access across different subtask creators and permits personal archival', async () => {
    await payload.update({
      collection: 'review-tasks',
      id: task,
      req: await req(0),
      overrideAccess: false,
      data: { assignee: users[1].id },
    })
    const personalChild = await payload.create({
      collection: 'review-tasks',
      req: await req(1),
      overrideAccess: false,
      depth: 0,
      data: {
        title: 'Personal delegated subtask',
        parent: task,
        status: 'open',
        priority: 'normal',
      },
    })
    expect(await canTask(await req(0), personalChild.id, 'edit')).toBe(true)
    expect(await canTask(await req(1), personalChild.id)).toBe(true)
    expect(await canTask(await req(3), personalChild.id)).toBe(false)
    await expect(
      payload.create({
        collection: 'review-tasks',
        req: await req(1),
        overrideAccess: false,
        data: {
          title: 'Do not expand personal access',
          parent: task,
          assignee: users[4].id,
          status: 'open',
          priority: 'normal',
        },
      }),
    ).rejects.toThrow(/Assignee/)
    await payload.update({
      collection: 'review-tasks',
      id: task,
      req: await req(0),
      overrideAccess: false,
      data: { archived: true },
    })
    expect(
      (await payload.findByID({ collection: 'review-tasks', id: personalChild.id })).archived,
    ).toBe(true)
  })
})
