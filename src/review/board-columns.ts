import type { Task } from './client'
import type { FieldResult } from './WorkspaceTaskDetails'
export type ColumnTask = Task & { fields: FieldResult[] }
export type ColumnFilter = { operator: string; value: string }
export function parseColumnFilters(input: unknown): Record<string, ColumnFilter> {
  try {
    const value = typeof input === 'string' && input.length <= 8000 ? JSON.parse(input) : input
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .filter(
          ([key, value]: [string, any]) =>
            key.length < 80 &&
            value &&
            ['eq', 'not-eq', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'not-empty'].includes(
              value.operator,
            ) &&
            typeof value.value === 'string' &&
            value.value.length <= 240,
        ),
    ) as Record<string, ColumnFilter>
  } catch {
    return {}
  }
}
export function columnValue(task: ColumnTask, key: string): unknown {
  if (key.startsWith('field:')) {
    const result = task.fields.find((item) => `field:${item.definition.id}` === key)
    return !result || result.error ? null : result.value
  }
  return key === 'assignee'
    ? (task.assignee ?? null)
    : key === 'dueDate'
      ? task.dueDate?.slice(0, 10)
      : (task as any)[key]
}
function atom(value: any): string | number | null {
  return value == null || value === '' || (Array.isArray(value) && !value.length)
    ? null
    : typeof value === 'number'
      ? Number.isFinite(value)
        ? value
        : null
      : typeof value === 'object'
        ? (value.label ??
          value.title ??
          (value.collection && value.id
            ? `${value.collection}:${value.id}`
            : String(value.id ?? '')))
        : String(value)
}
export function matchesColumn(task: ColumnTask, key: string, filter: ColumnFilter) {
  const raw = columnValue(task, key),
    empty = atom(raw) === null
  if (filter.operator === 'empty') return empty
  if (filter.operator === 'not-empty') return !empty
  if (empty) return false
  const values = Array.isArray(raw) ? raw : [raw]
  const match = (item: unknown) => {
    const actual = atom(item)
    if (actual === null) return false
    if (['gt', 'gte', 'lt', 'lte'].includes(filter.operator)) {
      const left =
          typeof actual === 'number'
            ? actual
            : /^\d{4}-\d\d-\d\d/.test(String(actual))
              ? String(actual).slice(0, 10)
              : Number(actual),
        right = typeof left === 'number' ? Number(filter.value) : filter.value
      if (typeof left === 'number' && (!Number.isFinite(left) || !Number.isFinite(right)))
        return false
      return filter.operator === 'gt'
        ? left > right
        : filter.operator === 'gte'
          ? left >= right
          : filter.operator === 'lt'
            ? left < right
            : left <= right
    }
    return filter.operator === 'contains'
      ? String(actual).toLowerCase().includes(filter.value.toLowerCase())
      : String(actual).toLowerCase() === filter.value.toLowerCase()
  }
  return filter.operator === 'not-eq' ? !values.some(match) : values.some(match)
}
export function compareColumns(a: ColumnTask, b: ColumnTask, key: string, descending = false) {
  const normal = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map(atom)
          .filter((item) => item !== null)
          .map(String)
          .sort()
          .join(', ') || null
      : atom(value)
  const av = normal(key === 'assignee' ? (a.assigneeLabel ?? a.assignee) : columnValue(a, key)),
    bv = normal(key === 'assignee' ? (b.assigneeLabel ?? b.assignee) : columnValue(b, key))
  if (av === null || bv === null) return av === bv ? a.id - b.id : av === null ? 1 : -1
  const result =
    typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
  return result ? (descending ? -result : result) : a.id - b.id
}
