import { describe, expect, it } from 'vitest'
import { boardFilter, countBoardTask } from '@/review/project-board-model'
import { siteCalendarDay } from '@/review/workspace-dates'

describe('project board summaries', () => {
  it('counts overdue, today, inclusive upcoming boundary, completed and undated tasks', () => {
    const counts = { all: 0, overdue: 0, upcoming: 0, completed: 0 }
    for (const task of [
      { status: 'open', dueDate: '2026-10-25T00:00:00Z' },
      { status: 'open', dueDate: '2026-10-26T00:00:00Z' },
      { status: 'in-progress', dueDate: '2026-11-02T00:00:00Z' },
      { status: 'open', dueDate: '2026-11-03T00:00:00Z' },
      { status: 'done', dueDate: '2026-10-20T00:00:00Z' },
      { status: 'done' },
      { status: 'open' },
      { status: 'open', archived: true },
      { status: 'open', parent: 1 },
    ])
      countBoardTask(counts, task, '2026-10-26')
    expect(counts).toEqual({ all: 7, overdue: 1, upcoming: 2, completed: 2 })
  })
  it('uses the site calendar day across UTC and daylight-saving boundaries', () => {
    expect(siteCalendarDay('2026-10-26T00:30:00Z', 'America/Chicago')).toBe('2026-10-25')
    expect(siteCalendarDay('2026-11-01T06:30:00Z', 'America/Chicago')).toBe('2026-11-01')
    expect(siteCalendarDay('2026-10-26T00:30:00Z')).toBe('2026-10-26')
  })
  it('accepts only the supported URL board filters', () => {
    for (const filter of ['all', 'overdue', 'upcoming', 'completed'])
      expect(boardFilter(filter)).toBe(filter)
    expect(boardFilter('unknown')).toBe('all')
    expect(boardFilter(null)).toBe('all')
  })
})
