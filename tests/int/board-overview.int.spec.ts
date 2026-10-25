import { createChapterUser } from '../helpers/native-authority'
import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import type { User } from '@/payload-types'
import { boardActivity, boardPeople } from '@/review/board-overview-service'
import { boardAudit } from '@/review/workspace-collections'
import { workspaceDB } from '@/review/workspace-access'
import { fileList } from '@/review/workspace-files'

describe('board Overview permissions, description and merged activity', () => {
  let payload: Payload, board: number, task: number, member: number
  const users: User[] = []
  const req = (index = 0) =>
    createLocalReq({ user: { ...users[index], collection: 'users' } }, payload)
  beforeAll(async () => {
    payload = await getPayload({ config })
    for (let i = 0; i < 3; i++)
      users.push(
        await createChapterUser(payload, 'editor', {
          collection: 'users',
          data: {
            username: `overview-${Date.now()}-${i}`,
            email: `overview-${Date.now()}-${i}@example.invalid`,
            password: 'overview-test-password',
            role: 'editor',
          },
        }),
      )
    board = (
      await payload.create({
        collection: 'task-boards',
        req: await req(),
        overrideAccess: false,
        data: { name: 'Overview', owner: users[0].id, visibility: 'private' },
      })
    ).id
    member = (
      await payload.create({
        collection: 'task-board-memberships',
        req: await req(),
        overrideAccess: false,
        data: { board, user: users[1].id, role: 'viewer', key: 'server' },
      })
    ).id
    task = (
      await payload.create({
        collection: 'review-tasks',
        req: await req(),
        overrideAccess: false,
        data: { title: 'Visible task', initialBoard: board, status: 'open', priority: 'normal' },
      })
    ).id
    await payload.create({
      collection: 'review-comments',
      req: await req(),
      overrideAccess: false,
      data: { task, body: 'Visible discussion' },
    })
    const moderated = await payload.create({
      collection: 'review-comments',
      req: await req(),
      overrideAccess: false,
      data: { task, body: 'Hidden moderated discussion' },
    })
    for (const comment of [undefined, moderated.id]) {
      const attachment = await payload.create({
        collection: 'task-attachments',
        req: await req(),
        overrideAccess: true,
        data: {
          board,
          task,
          ...(comment ? { comment } : {}),
          uploader: users[0].id,
          filename: comment ? 'hidden.pdf' : 'visible.pdf',
          objectKey: `overview/${Date.now()}/${comment || 0}`,
          mimeType: 'application/pdf',
          size: 20,
          state: 'staged',
        },
      })
      await payload.update({ collection: 'task-attachments', id: attachment.id,
        req: await req(), overrideAccess: true, data: { state: 'ready' } })
    }
    await workspaceDB(await req())
      .prepare('UPDATE review_comments SET moderated=1 WHERE id=?')
      .bind(moderated.id)
      .run()
    const hiddenBoard = (
      await payload.create({
        collection: 'task-boards',
        req: await req(2),
        overrideAccess: false,
        data: { name: 'Private other board', owner: users[2].id, visibility: 'private' },
      })
    ).id
    await payload.create({
      collection: 'review-tasks',
      req: await req(2),
      overrideAccess: false,
      data: { title: 'SECRET TASK', initialBoard: hiddenBoard, status: 'open', priority: 'normal' },
    })
    await boardAudit(await req(), String(board), 'Board event 0')
    // One live audited write exercises native authorization. The remaining
    // historical rows exercise pagination, without repeating 51 full staff
    // mutation workflows during fixture setup or increasing the hook timeout.
    const fixtureDB = workspaceDB(await req())
    await fixtureDB.batch(Array.from({ length: 51 }, (_, index) => fixtureDB
      .prepare('INSERT INTO task_board_activity(board_id,actor_id,message) VALUES(?,?,?)')
      .bind(board, users[0].id, `Board event ${index + 1}`)))
    // Equal timestamps exercise deterministic cross-collection cursor ordering.
    for (const table of [
      'task_board_activity',
      'review_activity',
      'review_comments',
      'task_attachments',
    ])
      await workspaceDB(await req())
        .prepare(`UPDATE ${table} SET created_at=?`)
        .bind('2026-10-19T12:00:00.000Z')
        .run()
  })
  it('paginates all activity sources without duplicates or restricted records', async () => {
    let cursor = '',
      total = 0
    const rows: any[] = []
    do {
      const result = await boardActivity(
        await req(1),
        String(board),
        new URLSearchParams({ limit: '10', cursor }),
      )
      total = result.totalDocs
      rows.push(...result.docs)
      cursor = result.nextCursor || ''
      expect(result.docs.length).toBeLessThanOrEqual(10)
    } while (cursor)
    expect(total).toBeGreaterThan(50)
    expect(rows).toHaveLength(total)
    expect(new Set(rows.map((row) => `${row.source}:${row.id}`)).size).toBe(total)
    expect(new Set(rows.map((row) => row.source))).toEqual(
      new Set(['board', 'task', 'comment', 'file']),
    )
    expect(rows.find((row) => row.source === 'comment')).toMatchObject({
      task,
      title: 'Visible task',
    })
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|hidden\.pdf|objectKey|Hidden moderated/)
    const defaults = await boardActivity(await req(), String(board), new URLSearchParams())
    expect(defaults.docs).toHaveLength(50)
    const visibleFile = rows.find((row) => row.source === 'file')
    const focused = await fileList(await req(1), { board }, 1, '', visibleFile.attachment)
    expect(focused.docs.map((file) => file.id)).toEqual([visibleFile.attachment])
    expect((await fileList(await req(1), { board }, 1, '', 999999)).docs).toHaveLength(0)
    await expect(
      boardActivity(await req(2), String(board), new URLSearchParams()),
    ).rejects.toThrow()
    await expect(
      boardActivity(await req(), String(board), new URLSearchParams({ cursor: 'invalid' })),
    ).rejects.toThrow('Invalid activity')
  })
  it('allows owners to save descriptions, rejecting viewers and stale updates', async () => {
    const record = await payload.findByID({ collection: 'task-boards', id: board, depth: 0 })
    const updated = await payload.update({
      collection: 'task-boards',
      id: board,
      req: await req(),
      overrideAccess: false,
      data: { description: 'Inline overview description', expectedUpdatedAt: record.updatedAt },
    })
    expect(updated.description).toBe('Inline overview description')
    await payload.update({
      collection: 'users',
      id: users[0].id,
      req: await req(),
      overrideAccess: false,
      data: { attributionPreference: 'email' },
    })
    const activity = await boardActivity(await req(1), String(board), new URLSearchParams())
    expect(activity.docs.find((row) => row.message === 'Board description changed')?.actor).toBe(
      users[0].email,
    )
    await expect(
      payload.update({
        collection: 'task-boards',
        id: board,
        req: await req(1),
        overrideAccess: false,
        data: { description: 'Forbidden' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'task-boards',
        id: board,
        req: await req(),
        overrideAccess: false,
        data: { description: 'Stale', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' },
      }),
    ).rejects.toThrow('changed')
  })
  it('returns eligible usernames and safe avatars only, and revokes access immediately', async () => {
    const result = await boardPeople(await req(1), String(board))
    expect(result.docs.map((person) => person.id)).toEqual(
      expect.arrayContaining([users[0].id, users[1].id]),
    )
    expect(result.docs.map((person) => person.id)).not.toContain(users[2].id)
    expect(JSON.stringify(result)).not.toMatch(/email|password|hash|salt/)
    expect(result.docs.find((person) => person.id === users[0].id)?.username).toBe(
      users[0].username,
    )
    await payload.delete({
      collection: 'task-board-memberships',
      id: member,
      req: await req(),
      overrideAccess: false,
    })
    await expect(boardPeople(await req(1), String(board))).rejects.toThrow()
    await expect(
      boardActivity(await req(1), String(board), new URLSearchParams()),
    ).rejects.toThrow()
  })
})
