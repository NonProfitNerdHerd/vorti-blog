import { describe, expect, it } from 'vitest'
import {
  defaultTaskFilters,
  localTaskDay,
  nextTaskDay,
  taskFiltersWhere,
  taskPagination,
  taskPresetFilters,
  taskPresets,
} from '@/review/dashboard-model'
import { taskDocumentLink } from '@/review/links'

describe('Task dashboard queries', () => {
  it('defaults to unfinished, non-archived tasks and ten rows', () => {
    const defaults = defaultTaskFilters()
    expect(defaults).toMatchObject({ status: 'active', archived: false, page: 1, limit: 10 })
    expect(taskFiltersWhere(defaults, '2026-10-17')).toEqual({
      and: [{ archived: { equals: false } }, { status: { not_equals: 'done' } }],
    })
  })
  it('builds independent preset queries and resets refinements', () => {
    expect(taskPresets).toHaveLength(6)
    const assigned = taskPresetFilters('assigned', '9', 25)
    expect(assigned).toMatchObject({
      assignee: '9',
      creator: '',
      search: '',
      archived: false,
      page: 1,
      limit: 25,
    })
    expect(taskPresetFilters('created', '9').creator).toBe('9')
    expect(taskFiltersWhere(taskPresetFilters('unassigned', '9'), '2026-10-17').and).toContainEqual(
      { assignee: { exists: false } },
    )
  })
  it('uses calendar boundaries so today is not overdue and day seven is included', () => {
    const overdue = taskFiltersWhere(taskPresetFilters('overdue', '1'), '2026-10-17')
    expect(overdue.and).toContainEqual({ dueDate: { less_than: '2026-10-17T00:00:00.000Z' } })
    const soon = taskFiltersWhere(taskPresetFilters('soon', '1'), '2026-10-17')
    expect(soon.and).toContainEqual({
      dueDate: {
        greater_than_equal: '2026-10-17T00:00:00.000Z',
        less_than: '2026-10-25T00:00:00.000Z',
      },
    })
    expect(soon.and).toContainEqual({ status: { not_equals: 'done' } })
    expect(nextTaskDay('2026-12-29', 8)).toBe('2027-01-06')
    expect(nextTaskDay('2026-03-07', 8)).toBe('2026-03-15')
    expect(nextTaskDay('2026-10-31', 8)).toBe('2026-11-08')
    const local = new Date(2026, 9, 17, 23, 59)
    expect(localTaskDay(local)).toBe('2026-10-17')
  })
  it('combines search, owner, status, advanced and due-date filters', () => {
    const where = taskFiltersWhere(
      {
        ...defaultTaskFilters(),
        search: 'review heading',
        status: 'ready-for-review',
        assignee: '2',
        creator: '3',
        priority: 'urgent',
        documentType: 'pages',
        due: 'before',
        before: '2026-10-20',
        archived: true,
      },
      '2026-10-17',
    )
    expect(where.and).toEqual(
      expect.arrayContaining([
        { archived: { equals: true } },
        { title: { contains: 'review' } },
        { title: { contains: 'heading' } },
        { status: { equals: 'ready-for-review' } },
        { assignee: { equals: '2' } },
        { creator: { equals: '3' } },
        { priority: { equals: 'urgent' } },
        { documentType: { equals: 'pages' } },
        { dueDate: { less_than_equal: '2026-10-20T23:59:59.999Z' } },
      ]),
    )
    expect(
      taskFiltersWhere({ ...defaultTaskFilters(), due: 'none' }, '2026-10-17').and,
    ).toContainEqual({ dueDate: { exists: false } })
    expect(
      taskFiltersWhere({ ...defaultTaskFilters(), due: 'today' }, '2026-10-17').and,
    ).toContainEqual({
      dueDate: {
        greater_than_equal: '2026-10-17T00:00:00.000Z',
        less_than: '2026-10-18T00:00:00.000Z',
      },
    })
  })
  it('honors valid pagination and bounds invalid values', () => {
    expect(taskPagination(new URLSearchParams('page=3&limit=25'))).toEqual({ page: 3, limit: 25 })
    expect(taskPagination(new URLSearchParams('page=-2&limit=no'))).toEqual({ page: 1, limit: 10 })
    expect(taskPagination(new URLSearchParams('page=1.5&limit=999'))).toEqual({
      page: 1,
      limit: 100,
    })
  })
  it('preserves task, region and custom admin routes in new-tab links', () => {
    expect(
      taskDocumentLink(
        { id: 8, documentType: 'site-templates', documentID: '2', region: 'footer' },
        '/manage',
      ),
    ).toBe('/manage/collections/site-templates/2?task=8&reviewRegion=footer')
  })
})
