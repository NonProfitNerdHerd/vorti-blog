export const entryStatuses = ['received', 'in-review', 'approved', 'rejected', 'completed'] as const
export type EntryStatus = typeof entryStatuses[number]
export interface EntryTransition { from: EntryStatus; to: EntryStatus; roles: ('administrator' | 'designer' | 'editor')[] }
export interface EntryWorkflow { transitions: EntryTransition[] }
export const defaultWorkflow: EntryWorkflow = { transitions: [
  { from: 'received', to: 'in-review', roles: ['administrator', 'editor'] },
  { from: 'received', to: 'approved', roles: ['administrator', 'editor'] },
  { from: 'received', to: 'rejected', roles: ['administrator', 'editor'] },
  { from: 'in-review', to: 'approved', roles: ['administrator', 'editor'] },
  { from: 'in-review', to: 'rejected', roles: ['administrator', 'editor'] },
  { from: 'approved', to: 'completed', roles: ['administrator', 'editor'] },
  { from: 'approved', to: 'in-review', roles: ['administrator', 'editor'] },
  { from: 'rejected', to: 'in-review', roles: ['administrator'] },
  { from: 'completed', to: 'in-review', roles: ['administrator'] },
] }
export function mayTransition(from: string, to: string, role: string, workflow = defaultWorkflow): boolean {
  return from === to || workflow.transitions.some(rule => rule.from === from && rule.to === to && rule.roles.some(allowed => allowed === role))
}
export function workflowIssues(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('transitions' in value) || !Array.isArray(value.transitions) || value.transitions.length > 100) return ['Workflow needs a list of allowed transitions.']
  const seen = new Set<string>()
  for (const rule of value.transitions) {
    if (!rule || !entryStatuses.includes(rule.from) || !entryStatuses.includes(rule.to) || rule.from === rule.to || !Array.isArray(rule.roles) || !rule.roles.length || rule.roles.some((role: unknown) => !['administrator', 'designer', 'editor'].includes(String(role)))) return ['Each transition needs different valid statuses and at least one existing role.']
    const key = `${rule.from}:${rule.to}`
    if (seen.has(key)) return ['Do not repeat a workflow transition; select its permitted roles together.']
    seen.add(key)
  }
  return []
}
