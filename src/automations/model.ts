/** Shared server/client registry. No executable expressions or arbitrary destinations. */
export const resources = ['review-tasks', 'pages', 'posts', 'form-submissions', 'contacts'] as const
export type Resource = (typeof resources)[number]
export const triggerFields: Record<Resource, readonly string[]> = {
  'review-tasks': ['status', 'assignee', 'priority', 'dueDate', 'title'],
  pages: ['title', '_status'],
  posts: ['title', '_status'],
  'form-submissions': ['workflowStatus'],
  contacts: ['profile'],
}
export const registry = {
  find: { label: 'Find record', fields: ['resource', 'id'], writes: false },
  create: { label: 'Create record / follow-up task', fields: ['resource', 'data'], writes: true },
  update: {
    label: 'Update record / assign owner',
    fields: ['resource', 'id', 'data'],
    writes: true,
  },
  condition: { label: 'Condition', fields: ['left', 'operator', 'right'], writes: false },
} as const
export type Value = unknown
export interface Step {
  id: string
  name: string
  kind: keyof typeof registry
  resource?: Resource
  recordID?: Value
  data?: Record<string, Value>
  left?: Value
  operator?: 'equals' | 'not-equals' | 'exists'
  right?: Value
  when?: { step: string; equals: boolean }
}
export interface Definition {
  trigger: {
    kind: 'manual' | 'created' | 'updated'
    resource?: Resource
    recordID?: string
    field?: string
  }
  steps: Step[]
}
const blocked = new Set(['__proto__', 'constructor', 'prototype'])
export function pathValue(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (blocked.has(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key))
      return undefined
    return (value as Record<string, unknown>)[key]
  }, root)
}
/** Mapping is an exact object reference, never evaluated code or string interpolation. */
export function resolve(value: unknown, context: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolve(v, context))
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && '$ref' in value) {
      const result = pathValue(context, String(value.$ref))
      if (result === undefined)
        throw Error(
          'A mapped field is unavailable. Check the previous step and current field permissions.',
        )
      return result
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (blocked.has(k)) throw Error('Invalid field name.')
        return [k, resolve(v, context)]
      }),
    )
  }
  return value
}
export function validateDefinition(value: unknown): Definition {
  if (!value || typeof value !== 'object') throw Error('Choose a trigger.')
  const definition = value as Definition
  if (!definition.trigger || !['manual', 'created', 'updated'].includes(definition.trigger.kind))
    throw Error('Choose a supported trigger.')
  if (definition.trigger.kind !== 'manual' && !resources.includes(definition.trigger.resource!))
    throw Error('Choose a trigger resource.')
  if (definition.trigger.kind === 'updated' && !definition.trigger.field)
    throw Error('Choose the field to watch.')
  if (
    definition.trigger.kind === 'updated' &&
    !triggerFields[definition.trigger.resource!].includes(definition.trigger.field!)
  )
    throw Error('Choose a supported field to watch.')
  if (
    definition.trigger.recordID !== undefined &&
    (typeof definition.trigger.recordID !== 'string' || definition.trigger.recordID.length > 100)
  )
    throw Error('Choose a valid trigger record.')
  if (!Array.isArray(definition.steps) || definition.steps.length > 30)
    throw Error('Use at most 30 blocks.')
  const ids = new Set<string>()
  for (const step of definition.steps) {
    if (
      !step ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(step.id) ||
      ids.has(step.id) ||
      !Object.hasOwn(registry, step.kind)
    )
      throw Error('Each block needs a unique ID and supported action.')
    if (typeof step.name !== 'string' || step.name.length > 160)
      throw Error('Enter a block name of at most 160 characters.')
    if (
      step.when &&
      (!ids.has(step.when.step) ||
        typeof step.when.equals !== 'boolean' ||
        definition.steps.find((s) => s.id === step.when!.step)?.kind !== 'condition')
    )
      throw Error('Choose an earlier condition for this branch.')
    const check = (v: unknown): void => {
      if (!v || typeof v !== 'object') return
      for (const [key, nested] of Object.entries(v)) {
        if (blocked.has(key)) throw Error('Invalid field name.')
        if (key === '$ref') {
          if (typeof nested !== 'string' || nested.length > 300)
            throw Error('Choose a valid mapped field.')
          const [source, id] = nested.split('.')
          if (source !== 'trigger' && !(source === 'steps' && ids.has(id)))
            throw Error('Map fields from the trigger or an earlier block.')
        } else check(nested)
      }
    }
    check(step)
    if (step.kind !== 'condition' && !resources.includes(step.resource!))
      throw Error('Choose a block resource.')
    if (step.kind === 'condition' && !['equals', 'not-equals', 'exists'].includes(step.operator!))
      throw Error('Choose a condition operator.')
    if (step.kind !== 'find' && step.resource === 'form-submissions')
      throw Error('Form submissions are read-only automation sources.')
    ids.add(step.id)
  }
  if (JSON.stringify(definition).length > 60000) throw Error('The workflow is too large.')
  return JSON.parse(JSON.stringify(definition))
}
export interface Reference {
  resource: Resource
  id: string
}
export interface StepResult {
  id: string
  name: string
  status: 'unexecuted' | 'running' | 'succeeded' | 'skipped' | 'failed'
  attempts: number
  startedAt?: string
  finishedAt?: string
  error?: string
  inputs?: unknown
  output?: unknown
  reference?: Reference
}
/** No provider credentials belong in definitions; mask conventional sensitive keys in diagnostics. */
export function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /secret|password|token|authorization|cookie|api.?key/i.test(k) ? '[masked]' : mask(v),
      ]),
    )
  return value
}
