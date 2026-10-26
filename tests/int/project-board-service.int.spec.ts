import { afterEach, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
vi.mock('@/review/project-access', () => ({ requireProject: vi.fn(async () => ({})) }))
import { projectBoardSummaries } from '@/review/project-board-service'
import { crmTaskInternalReadAllowed } from '@/crm/task-where'
import { internalWorkspace } from '@/review/workspace-access'

afterEach(() => vi.useRealTimers())
it('walks every board and task page and returns only projected authorized summaries', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-26T00:30:00Z'))
  const find = vi.fn(async (args) => {
    if (args.collection === 'task-boards') {
      expect(args.overrideAccess).toBe(false)
      return {
        docs: [{ id: args.page, name: `Board ${args.page}`, secret: 'never return' }],
        totalPages: 2,
      }
    }
    expect(crmTaskInternalReadAllowed(args.req)).toBe(true)
    expect(internalWorkspace(args.req)).toBe(true)
    expect(args.where.and).toContainEqual({ parent: { exists: false } })
    expect(args.where.and).toContainEqual({ archived: { not_equals: true } })
    const board = args.where.and[0].boards.equals
    return board === 1
      ? {
          docs: Array.from({ length: args.page === 1 ? 100 : 1 }, () => ({
            status: 'open',
            dueDate: '2026-10-24',
          })),
          totalPages: 2,
        }
      : { docs: [{ status: 'done' }], totalPages: 1 }
  })
  const req = {
    context: {},
    query: {},
    payload: {
      config: { collections: [] },
      find,
      findGlobal: vi.fn(async () => ({ timezone: 'America/Chicago' })),
    },
  } as unknown as PayloadRequest
  const result = await projectBoardSummaries(req, 7)
  expect(result.today).toBe('2026-10-25')
  expect(result.docs.map((board) => board.counts)).toEqual([
    { all: 101, overdue: 101, upcoming: 0, completed: 0 },
    { all: 1, overdue: 0, upcoming: 0, completed: 1 },
  ])
  expect(JSON.stringify(result)).not.toContain('never return')
  expect(crmTaskInternalReadAllowed(req)).toBe(false)
  expect(internalWorkspace(req)).toBe(false)
})
