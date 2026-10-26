import { nextTaskDay } from './dashboard-model'

export type BoardTaskCounts = { overdue: number; upcoming: number; completed: number; all: number }
export type ProjectBoardSummary = {
  id: number
  name: string
  description?: string | null
  inheritProject?: boolean | null
  counts: BoardTaskCounts
}
export const boardFilters = ['all', 'overdue', 'upcoming', 'completed'] as const
export type BoardFilter = (typeof boardFilters)[number]
export function boardFilter(value: string | null): BoardFilter {
  return boardFilters.includes(value as BoardFilter) ? (value as BoardFilter) : 'all'
}
export function countBoardTask(
  counts: BoardTaskCounts,
  task: {
    status?: string | null
    dueDate?: string | null
    archived?: boolean | null
    parent?: unknown
  },
  today: string,
) {
  if (task.archived || task.parent) return
  counts.all++
  if (task.status === 'done') counts.completed++
  else if (task.dueDate) {
    const day = task.dueDate.slice(0, 10)
    if (day < today) counts.overdue++
    else if (day <= nextTaskDay(today, 7)) counts.upcoming++
  }
}
