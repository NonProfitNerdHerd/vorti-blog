import type { Where } from 'payload'
import { taskSearchTerms } from './client'

export type TaskPreset = 'all' | 'assigned' | 'created' | 'unassigned' | 'overdue' | 'soon'
export type DueFilter = '' | 'overdue' | 'today' | 'soon' | 'none' | 'before'
export type TaskFilters = {
  search: string
  status: string
  assignee: string
  creator: string
  priority: string
  documentType: string
  due: DueFilter
  before: string
  archived: boolean
  page: number
  limit: number
}
export const taskPresets: { key: TaskPreset; label: string; hint: string }[] = [
  { key: 'all', label: 'All unfinished', hint: 'Across your site' },
  { key: 'assigned', label: 'Assigned to me', hint: 'Your next steps' },
  { key: 'created', label: 'Created by me', hint: 'Work you started' },
  { key: 'unassigned', label: 'Unassigned', hint: 'Needs an owner' },
  { key: 'overdue', label: 'Overdue', hint: 'Needs attention' },
  { key: 'soon', label: 'Due soon', hint: 'Today + next 7 days' },
]
export function defaultTaskFilters(): TaskFilters {
  return {
    search: '',
    status: 'active',
    assignee: '',
    creator: '',
    priority: '',
    documentType: '',
    due: '',
    before: '',
    archived: false,
    page: 1,
    limit: 10,
  }
}
export function taskPagination(params: URLSearchParams) {
  const positive = (value: string | null, fallback: number) => {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
  }
  return {
    page: positive(params.get('page'), 1),
    limit: Math.min(100, positive(params.get('limit'), 10)),
  }
}
export function localTaskDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function nextTaskDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function taskPresetFilters(preset: TaskPreset, userID: string, limit = 10): TaskFilters {
  const filters = { ...defaultTaskFilters(), limit }
  if (preset === 'assigned') filters.assignee = userID
  if (preset === 'created') filters.creator = userID
  if (preset === 'unassigned') filters.assignee = 'unassigned'
  if (preset === 'overdue' || preset === 'soon') filters.due = preset
  return filters
}
/** Complete, validated URL state lets Dashboard links restore a personal task view. */
export function taskURLState(params: URLSearchParams, userID: string) {
  const requested = params.get('taskView')
  const preset: TaskPreset = taskPresets.some(({ key }) => key === requested)
    ? (requested as TaskPreset)
    : 'all'
  const filters = { ...taskPresetFilters(preset, userID), ...taskPagination(params) }
  for (const key of ['search', 'assignee', 'creator', 'before'] as const)
    if (params.has(key)) filters[key] = params.get(key)!.slice(0, 120)
  const choices = {
    status: ['', 'active', 'open', 'in-progress', 'ready-for-review', 'done'],
    priority: ['', 'low', 'normal', 'high', 'urgent'],
    documentType: ['', 'posts', 'pages', 'site-templates', 'design-templates'],
    due: ['', 'overdue', 'today', 'soon', 'none', 'before'],
  }
  for (const key of ['status', 'priority', 'documentType', 'due'] as const) {
    const value = params.get(key)
    if (value !== null && choices[key].includes(value)) Object.assign(filters, { [key]: value })
  }
  if (params.has('archived')) filters.archived = params.get('archived') === 'true'
  return { preset, filters }
}
export function writeTaskURL(params: URLSearchParams, filters: TaskFilters, preset: TaskPreset) {
  params.set('taskView', preset)
  for (const [key, value] of Object.entries(filters)) params.set(key, String(value))
  return params
}
export function taskFiltersWhere(filters: TaskFilters, today: string): Where {
  const and: Where[] = [{ archived: { equals: filters.archived } }]
  for (const term of taskSearchTerms(filters.search)) and.push({ title: { contains: term } })
  if (filters.status)
    and.push({
      status: filters.status === 'active' ? { not_equals: 'done' } : { equals: filters.status },
    })
  if (filters.assignee)
    and.push({
      assignee:
        filters.assignee === 'unassigned' ? { exists: false } : { equals: filters.assignee },
    })
  if (filters.creator) and.push({ creator: { equals: filters.creator } })
  if (filters.priority) and.push({ priority: { equals: filters.priority } })
  if (filters.documentType) and.push({ documentType: { equals: filters.documentType } })
  if (filters.due === 'none') and.push({ dueDate: { exists: false } })
  if (filters.due === 'overdue') and.push({ dueDate: { less_than: `${today}T00:00:00.000Z` } })
  if (filters.due === 'today' || filters.due === 'soon') {
    and.push({
      dueDate: {
        greater_than_equal: `${today}T00:00:00.000Z`,
        less_than: `${nextTaskDay(today, filters.due === 'today' ? 1 : 8)}T00:00:00.000Z`,
      },
    })
  }
  if (filters.due === 'overdue' || filters.due === 'soon')
    and.push({ status: { not_equals: 'done' } })
  if (filters.due === 'before' && filters.before)
    and.push({ dueDate: { less_than_equal: `${filters.before}T23:59:59.999Z` } })
  return { and }
}
