import type { Task } from './client'
import { localTaskDay, nextTaskDay } from './dashboard-model'

export function boardProgress(tasks: Task[], now = new Date()) {
  const today = localTaskDay(now),
    soon = nextTaskDay(today, 7)
  const values = { done: 0, overdue: 0, upcoming: 0, remaining: 0 }
  for (const task of tasks) {
    const due = task.dueDate?.slice(0, 10)
    if (task.status === 'done') values.done++
    else if (due && due < today) values.overdue++
    else if (due && due <= soon) values.upcoming++
    else values.remaining++
  }
  return values
}
