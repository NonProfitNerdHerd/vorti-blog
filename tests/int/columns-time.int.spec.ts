import { createChapterUser, fixtureOperator } from '../helpers/native-authority'
import { beforeAll, describe, it, expect } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { mutateTime, timeSummary, timeAudit, workTotal } from '@/review/workspace-time'
import { workspaceDB } from '@/review/workspace-access'

describe('Collaborators and atomic, protected work time', () => {
  let payload: Payload, board: number, task: number, member: number
  const users: User[] = []
  const req = (i = 0) => createLocalReq({ user: { ...users[i], collection: 'users' } }, payload)
  beforeAll(async () => {
    payload = await getPayload({ config })
    for (let i = 0; i < 4; i++)
      users.push(
        i === 3 ? await fixtureOperator(payload) : await createChapterUser(payload, 'editor', {
          collection: 'users',
          data: {
            username: `time-${Date.now()}-${i}`,
            email: `time-${Date.now()}-${i}@example.invalid`,
            password: 'time-test-password',
            role: i === 3 ? 'administrator' : 'editor',
          },
        }),
      )
    board = (
      await payload.create({
        collection: 'task-boards',
        req: await req(),
        overrideAccess: false,
        data: { name: 'Time controls', owner: users[0].id, visibility: 'private' },
      })
    ).id
    member = (
      await payload.create({
        collection: 'task-board-memberships',
        req: await req(),
        overrideAccess: false,
        data: { board, user: users[1].id, role: 'editor', key: 'server' },
      })
    ).id
    task = (
      await payload.create({
        collection: 'review-tasks',
        req: await req(),
        overrideAccess: false,
        data: {
          title: 'Timed task',
          initialBoard: board,
          status: 'open',
          priority: 'normal',
          assignee: users[0].id,
          collaborators: [users[1].id, users[1].id, users[0].id],
        },
      })
    ).id
  })
  it('deduplicates eligible collaborators without assignment, following, or access grants', async () => {
    const doc = (await payload.findByID({
      collection: 'review-tasks',
      id: task,
      req: await req(),
      overrideAccess: false,
      depth: 0,
    })) as any
    expect(doc.assignee).toBe(users[0].id)
    expect(doc.collaborators).toEqual([users[1].id])
    expect(doc.collaboratorPeople[0].username).toBe(users[1].username)
    expect(
      (
        await payload.count({
          collection: 'task-followers',
          overrideAccess: true,
          where: { and: [{ task: { equals: task } }, { user: { equals: users[1].id } }] },
        })
      ).totalDocs,
    ).toBe(0)
    await expect(
      payload.update({
        collection: 'review-tasks',
        id: task,
        req: await req(),
        overrideAccess: false,
        data: { collaborators: [users[2].id] },
      }),
    ).rejects.toThrow('already have access')
  })
  it('starts, pauses, resumes and retries without duplicating work or audit rows', async () => {
    const started = await mutateTime(await req(), task, {
      action: 'start-time',
      operationKey: 'start-operation-1',
    })
    const id = started.activeTimer.id
    await workspaceDB(await req())
      .prepare('UPDATE task_time_entries SET started_at=? WHERE id=?')
      .bind(new Date(Date.now() - 120000).toISOString(), id)
      .run()
    expect(await workTotal(await req(), task)).toBeGreaterThanOrEqual(119)
    const data = {
      action: 'stop-time',
      entry: id,
      expectedUpdatedAt: started.activeTimer.updatedAt,
      operationKey: 'pause-operation-1',
    }
    const stopped = await mutateTime(await req(), task, data)
    expect(stopped.seconds).toBeGreaterThanOrEqual(119)
    await mutateTime(await req(), task, data)
    expect((await timeAudit(await req(), task)).totalDocs).toBe(2)
    await expect(mutateTime(await req(), task, { ...data, note: 'different' })).rejects.toThrow(
      'different change',
    )
    const replay = await mutateTime(await req(), task, {
      action: 'start-time',
      operationKey: 'start-operation-1',
    })
    expect(replay.activeTimer).toBeNull()
    const resumed = await mutateTime(await req(), task, {
      action: 'start-time',
      operationKey: 'resume-operation-1',
    })
    expect(resumed.activeTimer.id).not.toBe(id)
    await mutateTime(await req(), task, {
      action: 'stop-time',
      entry: resumed.activeTimer.id,
      expectedUpdatedAt: resumed.activeTimer.updatedAt,
    })
  })
  it('preserves detailed visibility, manager reasons, and complete immutable correction history', async () => {
    const start = new Date(Date.now() - 3600000).toISOString(),
      end = new Date(Date.now() - 1800000).toISOString()
    const saved = await mutateTime(await req(1), task, {
      action: 'save-time',
      startedAt: start,
      endedAt: end,
      note: 'Personal work',
      operationKey: 'manual-operation-1',
    })
    const entry = saved.entries[0]
    expect(saved.entries.every((row: any) => row.user === users[1].id)).toBe(true)
    const manager = await timeSummary(await req(), task)
    expect(manager.entries.some((row: any) => row.user === users[1].id)).toBe(true)
    await expect(
      mutateTime(await req(), task, {
        action: 'save-time',
        entry: entry.id,
        expectedUpdatedAt: entry.updatedAt,
        startedAt: start,
        endedAt: end,
        note: 'Corrected',
      }),
    ).rejects.toThrow('reason')
    const changed = await mutateTime(await req(), task, {
      action: 'save-time',
      entry: entry.id,
      expectedUpdatedAt: entry.updatedAt,
      startedAt: start,
      endedAt: new Date(Date.parse(end) - 600000).toISOString(),
      note: 'Corrected',
      reason: 'Remove break',
      operationKey: 'correct-operation-1',
    })
    const history = await timeAudit(await req(1), task)
    const correction = history.docs.find((row: any) => row.action === 'correct') as any
    expect(correction.beforeValue.seconds).toBe(1800)
    expect(correction.afterValue.seconds).toBe(1200)
    expect(correction.reason).toBe('Remove break')
    expect(history.docs.every((row: any) => row.entryUser === users[1].id)).toBe(true)
    await expect(
      mutateTime(await req(), task, {
        action: 'save-time',
        entry: entry.id,
        expectedUpdatedAt: entry.updatedAt,
        startedAt: start,
        endedAt: end,
        reason: 'stale',
      }),
    ).rejects.toThrow('changed')
    for (const i of [0, 1, 3]) {
      await expect(
        payload.update({
          collection: 'task-time-audit',
          id: correction.id,
          req: await req(i),
          overrideAccess: false,
          data: { reason: 'tamper' },
        }),
      ).rejects.toThrow()
      await expect(
        payload.delete({
          collection: 'task-time-audit',
          id: correction.id,
          req: await req(i),
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    }
    await expect(
      payload.create({
        collection: 'task-time-audit',
        req: await req(3),
        overrideAccess: true,
        data: {
          task,
          entry: entry.id,
          actor: users[3].id,
          entryUser: users[1].id,
          action: 'fake',
          operationKey: 'fake-op',
          fingerprint: 'fake',
        },
      }),
    ).rejects.toThrow('generated only')
    expect(changed.seconds).toBeGreaterThan(1200)
  })
  it('serializes concurrent starts and explicitly switches without duplicate audit events', async () => {
    const other = (
      await payload.create({
        collection: 'review-tasks',
        req: await req(),
        overrideAccess: false,
        data: { title: 'Other timer', initialBoard: board, status: 'open', priority: 'normal' },
      })
    ).id
    const raced = await Promise.allSettled([
      mutateTime(await req(), task, { action: 'start-time', operationKey: 'race-operation-one' }),
      mutateTime(await req(), task, { action: 'start-time', operationKey: 'race-operation-two' }),
    ])
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const active = (await timeSummary(await req(), task)).activeTimer
    const request = {
      action: 'switch-time',
      expectedUpdatedAt: active.updatedAt,
      operationKey: 'switch-operation-one',
    }
    const switched = await mutateTime(await req(), other, request)
    expect(switched.activeTimer.task).toBe(other)
    await mutateTime(await req(), other, request)
    expect((await timeAudit(await req(), other)).totalDocs).toBe(1)
    await mutateTime(await req(), other, {
      action: 'stop-time',
      entry: switched.activeTimer.id,
      expectedUpdatedAt: switched.activeTimer.updatedAt,
    })
    const before = (await timeAudit(await req(), task)).totalDocs
    await expect(
      mutateTime(await req(), task, {
        action: 'save-time',
        startedAt: new Date(Date.now() - 119000).toISOString(),
        endedAt: new Date(Date.now() - 30000).toISOString(),
      }),
    ).rejects.toThrow('overlaps')
    expect((await timeAudit(await req(), task)).totalDocs).toBe(before)
  })
  it('keeps totals public to task readers but removes revoked collaborators and access', async () => {
    await payload.create({
      collection: 'task-board-memberships',
      req: await req(),
      overrideAccess: false,
      data: { board, user: users[2].id, role: 'viewer', key: 'server' },
    })
    const visible = await timeSummary(await req(2), task)
    expect(visible.seconds).toBeGreaterThan(0)
    expect(visible.entries).toHaveLength(0)
    await expect(mutateTime(await req(2), task, { action: 'start-time' })).rejects.toThrow()
    await payload.delete({
      collection: 'task-board-memberships',
      id: member,
      req: await req(),
      overrideAccess: false,
    })
    const doc = (await payload.findByID({
      collection: 'review-tasks',
      id: task,
      req: await req(),
      overrideAccess: false,
      depth: 0,
    })) as any
    expect(doc.collaborators).toHaveLength(0)
    expect(doc.collaboratorPeople).toHaveLength(0)
    await expect(timeSummary(await req(1), task)).rejects.toThrow()
  })
})
