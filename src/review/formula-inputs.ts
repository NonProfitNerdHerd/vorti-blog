export const nativeFormulaFields = {
  ntitle: 'Task title',
  nstatus: 'Status',
  npriority: 'Priority',
  nassignee: 'Assignee ID',
  ncreator: 'Created by ID',
  nstartDate: 'Start date',
  ndueDate: 'Due date',
  ncreatedAt: 'Created on',
  nupdatedAt: 'Last modified on',
  ncompletedAt: 'Completed on',
  nmilestone: 'Milestone',
  nid: 'Task ID',
} as const
export function nativeFormulaValue(task: Record<string, unknown>, key: string): unknown {
  if (!(key in nativeFormulaFields)) throw new Error('Unknown native formula input.')
  const field = key.slice(1),
    value = task[field]
  if (['assignee', 'creator'].includes(field))
    return value && typeof value === 'object' ? (value as { id: number }).id : (value ?? null)
  if (['startDate', 'dueDate', 'createdAt', 'updatedAt', 'completedAt'].includes(field))
    return typeof value === 'string' ? value.slice(0, 10) : null
  return value ?? null
}
