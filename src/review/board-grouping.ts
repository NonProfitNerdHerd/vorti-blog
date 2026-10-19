import { statuses, type Task } from './client'
import { localTaskDay } from './dashboard-model'
import type { FieldDefinition, FieldResult } from './WorkspaceTaskDetails'
export const nativeGroups = {
  section: 'Custom sections',
  status: 'Status',
  project: 'Project',
  startDate: 'Start date',
  dueDate: 'Due date',
  assignee: 'Assignee',
  creator: 'Created by',
  createdAt: 'Created on',
  updatedAt: 'Last modified on',
  completedAt: 'Completed on',
  priority: 'Priority',
}
export type GroupTask = Task & { fields: FieldResult[]; creatorLabel?: string }
const emptyLabel = (group: string) =>
  group === 'assignee'
    ? 'Unassigned'
    : group === 'completedAt'
      ? 'No completion date'
      : ['dueDate', 'startDate', 'createdAt', 'updatedAt'].includes(group)
        ? 'No date'
        : 'No value'
export function groupValues(
  task: GroupTask,
  group: string,
  section: string,
  project?: { id: number; name: string },
) {
  if (group === 'section') return [{ key: section, label: section }]
  if (group === 'project')
    return [
      { key: project ? String(project.id) : '', label: project?.name ?? 'Unavailable project' },
    ]
  if (group.startsWith('field:')) {
    const result = task.fields.find((item) => `field:${item.definition.id}` === group)
    if (result?.error) return [{ key: '!unavailable', label: 'Unavailable' }]
    const values = Array.isArray(result?.value) ? result.value : [result?.value]
    return values.length
      ? values.map((value) => {
          if (value == null || value === '') return { key: '', label: 'No value' }
          const option = result?.definition.configuration?.options?.find(
            (option) => option.id === value,
          )
          if (typeof value === 'object')
            return {
              key: JSON.stringify({ collection: value.collection, id: value.id }),
              label: String(value.label ?? 'Reference'),
            }
          return { key: String(value), label: option?.label ?? String(value) }
        })
      : [{ key: '', label: 'No value' }]
  }
  const value = task[group as keyof Task]
  if (!value) return [{ key: '', label: emptyLabel(group) }]
  if (['createdAt', 'updatedAt', 'completedAt'].includes(group)) {
    const date = localTaskDay(new Date(String(value)))
    return [{ key: date, label: date }]
  }
  if (['startDate', 'dueDate'].includes(group))
    return [{ key: String(value).slice(0, 10), label: String(value).slice(0, 10) }]
  return [
    {
      key: String(value),
      label:
        group === 'status'
          ? statuses[value as keyof typeof statuses]
          : group === 'assignee'
            ? (task.assigneeLabel ?? 'Assigned user')
            : group === 'creator'
              ? (task.creatorLabel ?? 'Created by user')
              : String(value),
    },
  ]
}
export function editableGroup(group: string, field?: FieldDefinition) {
  return (
    ['section', 'status', 'priority', 'assignee', 'startDate', 'dueDate'].includes(group) ||
    (!!field &&
      ['single-select', 'multi-select', 'people', 'reference', 'date', 'text', 'number'].includes(
        field.kind,
      ))
  )
}
export function groupFieldValue(
  field: FieldDefinition,
  key: string,
  previous: unknown = null,
  source?: string,
) {
  if (!key) return ['multi-select', 'people', 'reference'].includes(field.kind) ? [] : null
  const item =
    field.kind === 'people' || field.kind === 'number'
      ? Number(key)
      : field.kind === 'reference'
        ? JSON.parse(key)
        : key
  if (!['multi-select', 'people', 'reference'].includes(field.kind)) return item
  const values = Array.isArray(previous) ? previous : []
  return [
    ...values.filter((value) => {
      const id =
        typeof value === 'object'
          ? JSON.stringify({ collection: value.collection, id: value.id })
          : String(value)
      return id !== source && id !== key
    }),
    item,
  ]
}
