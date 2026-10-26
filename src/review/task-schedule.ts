import type { Task } from './client'
import { nextTaskDay } from './dashboard-model'
import { siteCalendarDay } from './workspace-dates'
export const timelineRanges = [7, 14, 28, 60, 90, 120, 180, 240, 365]
export type CalendarDisplay = 'due' | 'open' | 'created'
export function calendarTaskSpan(task: Task, display: CalendarDisplay, timezone: string) {
  if (display === 'open' && (task.status === 'done' || task.archived)) return null
  const due = task.dueDate?.slice(0, 10),
    start = task.startDate?.slice(0, 10)
  if (display === 'created') {
    const date = task.createdAt ? siteCalendarDay(task.createdAt, timezone) : undefined
    return { start: date, end: date }
  }
  return display === 'open' ? { start: start || due, end: due || start } : { start: due, end: due }
}
export function moveTaskDates(task: Task, days: number, edge: 'move' | 'start' | 'end') {
  const start = task.startDate?.slice(0, 10) || task.dueDate?.slice(0, 10)
  const end = task.dueDate?.slice(0, 10) || start
  if (!start || !end) return null
  const nextStart = edge === 'end' ? start : nextTaskDay(start, days)
  const nextEnd = edge === 'start' ? end : nextTaskDay(end, days)
  if (nextStart > nextEnd) return null
  return { startDate: `${nextStart}T12:00:00.000Z`, dueDate: `${nextEnd}T12:00:00.000Z` }
}
