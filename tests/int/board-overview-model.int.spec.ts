import { expect, it } from 'vitest'
import { boardProgress } from '@/review/board-overview-model'
import type { Task } from '@/review/client'

it('partitions progress without treating today as overdue or completed deadlines as late', () => {
  const task = (status: string, dueDate?: string) => ({ status, dueDate }) as Task
  expect(
    boardProgress(
      [
        task('done', '2026-10-01'),
        task('open', '2026-10-18'),
        task('open', '2026-10-19'),
        task('in-progress', '2026-10-26'),
        task('open', '2026-10-27'),
        task('open'),
      ],
      new Date(2026, 9, 19, 23, 59),
    ),
  ).toEqual({ done: 1, overdue: 1, upcoming: 2, remaining: 2 })
  expect(boardProgress([])).toEqual({ done: 0, overdue: 0, upcoming: 0, remaining: 0 })
})
