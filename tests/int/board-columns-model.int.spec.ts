import { expect, it } from 'vitest'
import {
  compareColumns,
  matchesColumn,
  parseColumnFilters,
  type ColumnTask,
} from '@/review/board-columns'
const task = (id: number, value: unknown, error?: string) =>
  ({ id, title: `Task ${id}`, fields: [{ definition: { id: 1 }, value, error }] }) as ColumnTask
it('sorts typed values and keeps empty or restricted values last in either direction', () => {
  const list = [task(1, null), task(2, 10), task(3, 2), task(4, 999, 'Unavailable')]
  expect([...list].sort((a, b) => compareColumns(a, b, 'field:1')).map((item) => item.id)).toEqual([
    3, 2, 1, 4,
  ])
  expect(
    [...list].sort((a, b) => compareColumns(a, b, 'field:1', true)).map((item) => item.id),
  ).toEqual([2, 3, 1, 4])
})
it('filters dates, numbers and multi-values without treating unavailable values as values', () => {
  expect(matchesColumn(task(1, 12), 'field:1', { operator: 'gt', value: '10' })).toBe(true)
  expect(matchesColumn(task(1, ['a', 'b']), 'field:1', { operator: 'eq', value: 'b' })).toBe(true)
  expect(matchesColumn(task(1, ['a', 'b']), 'field:1', { operator: 'not-eq', value: 'b' })).toBe(
    false,
  )
  expect(
    matchesColumn(task(1, '2026-10-19'), 'field:1', { operator: 'lte', value: '2026-10-19' }),
  ).toBe(true)
  expect(matchesColumn(task(1, 20, 'Unavailable'), 'field:1', { operator: 'gt', value: '1' })).toBe(
    false,
  )
  expect(parseColumnFilters('{bad')).toEqual({})
})
