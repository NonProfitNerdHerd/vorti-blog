import type { PayloadRequest } from 'payload'
import { relationID } from './documents'
import { reject, requireTask, workspaceDB } from './workspace-access'
import { workspaceFormula, workspaceReferences } from './workspace-formula'

export type Definition = {
  id: number
  name: string
  kind: string
  configuration?: unknown
  archived?: boolean | null
  systemKey?: string | null
}
export type FieldConfig = {
  options?: { id: string; label: string; color?: string; retired?: boolean }[]
  expression?: string
  referenceField?: number
  property?: string
  precision?: number
  prefix?: string
}
export type FieldEvaluation = {
  boards: Map<string, Promise<Definition[]>>
  definitions: Map<number, Promise<Definition>>
  references: Map<string, Promise<Record<string, unknown> | null>>
}
export const fieldEvaluation = (): FieldEvaluation => ({
  boards: new Map(),
  definitions: new Map(),
  references: new Map(),
})
const properties: Record<string, string[]> = {
  'review-tasks': ['title', 'status', 'priority', 'dueDate', 'startDate', 'milestone'],
  'task-boards': ['name', 'description', 'archived'],
  'task-projects': ['name', 'description', 'archived'],
  posts: ['title', 'slug', 'excerpt'],
  pages: ['title', 'slug'],
}
export async function validateFieldDefinition(
  req: PayloadRequest,
  definition: Record<string, any>,
) {
  const config = (definition.configuration ?? {}) as FieldConfig
  if (JSON.stringify(config).length > 16000) reject('Field configuration is too large.', 400)
  if (
    config.precision !== undefined &&
    (!Number.isInteger(config.precision) || config.precision < 0 || config.precision > 6)
  )
    reject('Precision must be 0–6.', 400)
  if (['single-select', 'multi-select'].includes(definition.kind)) {
    if (!Array.isArray(config.options) || config.options.length > 100)
      reject('Provide up to 100 select options.', 400)
    const ids = new Set<string>()
    for (const option of config.options!) {
      if (
        !/^[\w-]{1,60}$/.test(option.id) ||
        ids.has(option.id) ||
        !option.label?.trim() ||
        option.label.length > 100 ||
        (option.color && !/^#[\da-fA-F]{6}$/.test(option.color))
      )
        reject('Select options need unique IDs, labels, and valid hex colors.', 400)
      ids.add(option.id)
    }
    if (definition.id) {
      const previous = await req.payload.findByID({
        collection: 'task-field-definitions',
        id: definition.id,
        req,
        overrideAccess: true,
        depth: 0,
      })
      const old = (previous.configuration ?? {}) as FieldConfig
      if (old.options?.some((option) => !ids.has(option.id)))
        reject('Retire existing options instead of deleting them.', 400)
    }
  }
  if (definition.kind === 'lookup') {
    if (
      !config.referenceField ||
      !config.property ||
      !Object.values(properties).some((list) => list.includes(config.property!))
    )
      reject('Choose a Reference field and a supported direct property.', 400)
    const reference = await req.payload.findByID({
      collection: 'task-field-definitions',
      id: config.referenceField,
      req,
      depth: 0,
      overrideAccess: true,
    })
    if (reference.kind !== 'reference') reject('Lookups require a Reference field.', 400)
  }
  if (definition.kind === 'formula') {
    const visited = new Set<number>(),
      active = new Set<number>()
    const walk = async (current: Record<string, any>, depth = 0) => {
      if (depth > 20) reject('Formula dependency chain is too deep.', 400)
      const id = Number(current.id ?? -1)
      if (active.has(id)) reject('Formula dependencies contain a cycle.', 400)
      if (visited.has(id)) return
      active.add(id)
      let references: string[]
      try {
        references = workspaceReferences(String(current.configuration?.expression ?? ''))
      } catch (error) {
        reject((error as Error).message, 400)
      }
      for (const reference of references!) {
        const targetID = Number(reference.slice(1))
        if (targetID === definition.id) reject('A formula cannot refer to itself.', 400)
        const target =
          targetID === definition.id
            ? definition
            : await req.payload.findByID({
                collection: 'task-field-definitions',
                id: targetID,
                req,
                overrideAccess: true,
                depth: 0,
              })
        if (target.kind === 'formula') await walk(target, depth + 1)
      }
      active.delete(id)
      visited.add(id)
    }
    await walk(definition)
  }
}
export async function visibleReference(
  req: PayloadRequest,
  reference: { collection: string; id: number | string },
  cache?: FieldEvaluation,
) {
  if (!Object.hasOwn(properties, reference.collection)) return null
  const key = `${req.user?.id}:${reference.collection}:${reference.id}`
  if (cache?.references.has(key)) return cache.references.get(key)!
  const read = async () => {
    try {
      return (await req.payload.findByID({
        collection: reference.collection as 'review-tasks',
        id: reference.id,
        req,
        overrideAccess: false,
        depth: 0,
      })) as unknown as Record<string, unknown>
    } catch (error) {
      if ([403, 404].includes((error as { status?: number }).status ?? 0)) return null
      throw error
    }
  }
  const result = read()
  cache?.references.set(key, result)
  return result
}
export async function validateFieldValue(
  req: PayloadRequest,
  definition: Definition,
  value: unknown,
  previous?: unknown,
) {
  const config = (definition.configuration ?? {}) as FieldConfig
  if (value === null || value === undefined) return null
  if (definition.archived) reject('This field is archived.', 409)
  if (definition.kind === 'text') {
    if (typeof value !== 'string' || value.length > 10000)
      reject('Text must be at most 10,000 characters.', 400)
  } else if (definition.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) reject('Enter a finite number.', 400)
    if (definition.systemKey === 'estimated-hours' && Number(value) < 0)
      reject('Estimated hours cannot be negative.', 400)
  } else if (definition.kind === 'date') {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      reject('Enter a valid calendar date.', 400)
  } else if (['single-select', 'multi-select'].includes(definition.kind)) {
    const values = definition.kind === 'single-select' ? [value] : value
    if (
      !Array.isArray(values) ||
      values.length > 100 ||
      values.some(
        (id) =>
          !config.options?.some(
            (option) =>
              option.id === id &&
              (!option.retired ||
                (Array.isArray(previous) ? previous.includes(id) : previous === id)),
          ),
      )
    )
      reject('Choose available options.', 400)
  } else if (definition.kind === 'people') {
    if (!Array.isArray(value) || value.length > 50) reject('Choose up to 50 people.', 400)
    if (
      (value as number[]).some((id) => !Number.isInteger(id)) ||
      new Set(value as number[]).size !== (value as number[]).length
    )
      reject('Select distinct existing people.', 400)
    if (
      (value as number[]).length &&
      (
        await req.payload.count({
          collection: 'users',
          req,
          overrideAccess: true,
          where: { id: { in: value as number[] } },
        })
      ).totalDocs !== (value as number[]).length
    )
      reject('Select existing people.', 400)
  } else if (definition.kind === 'reference') {
    if (!Array.isArray(value) || value.length > 30) reject('Choose up to 30 references.', 400)
    const references = []
    for (const reference of value as { collection: string; id: number }[]) {
      if (!reference || typeof reference !== 'object')
        reject('A selected reference is unavailable.', 400)
      const target = await visibleReference(req, reference)
      if (!target) reject('A selected reference is unavailable.', 400)
      references.push({ collection: reference.collection, id: target!.id })
    }
    return references
  } else reject('This field is computed or uses its own timer controls.', 400)
  return value
}
export async function taskFields(
  req: PayloadRequest,
  taskID: number,
  knownTask?: { id: number; boards?: unknown[] | null },
  cache = fieldEvaluation(),
) {
  const task = knownTask ?? (await requireTask(req, taskID))
  const definitions = new Map<number, Definition>(),
    values = new Map<number, unknown>(),
    results = new Map<number, { value: unknown; error?: string }>()
  // Return only fields attached to boards this viewer can see. Never disclose hidden board metadata.
  for (const board of task.boards ?? []) {
    const id = Number(relationID(board))
    const key = `${req.user?.id}:${id}`
    if (!cache.boards.has(key))
      cache.boards.set(
        key,
        (async () => {
          const accessible = await req.payload.count({
            collection: 'task-boards',
            req,
            overrideAccess: false,
            where: { id: { equals: id } },
          })
          if (!accessible.totalDocs) return []
          const attached = await req.payload.find({
            collection: 'task-board-fields',
            req,
            overrideAccess: false,
            depth: 0,
            pagination: false,
            where: { board: { equals: id } },
            sort: 'position',
          })
          const visible = []
          for (const attachment of attached.docs) {
            const fieldID = Number(relationID(attachment.field))
            if (!cache.definitions.has(fieldID))
              cache.definitions.set(
                fieldID,
                req.payload.findByID({
                  collection: 'task-field-definitions',
                  id: fieldID,
                  req,
                  depth: 0,
                  overrideAccess: false,
                }),
              )
            const definition = await cache.definitions.get(fieldID)!
            if (!definition.archived) visible.push(definition)
          }
          return visible
        })(),
      )
    for (const definition of await cache.boards.get(key)!)
      definitions.set(definition.id, definition)
  }
  const storedValues = await req.payload.find({
    collection: 'task-field-values',
    req,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    where: { task: { equals: taskID } },
  })
  for (const value of storedValues.docs)
    values.set(Number(relationID(value.field)), value.value ?? null)
  let timeTotal: Promise<{ seconds: number } | null> | undefined
  const evaluate = async (
    id: number,
    active = new Set<number>(),
  ): Promise<{ value: unknown; error?: string }> => {
    if (results.has(id)) return results.get(id)!
    const definition = definitions.get(id)
    if (!definition || active.has(id) || active.size > 20)
      return { value: null, error: 'Unavailable input' }
    const config = (definition.configuration ?? {}) as FieldConfig
    active.add(id)
    let result: { value: unknown; error?: string }
    try {
      if (definition.kind === 'id') result = { value: `${config.prefix ?? ''}${task.id}` }
      else if (definition.kind === 'formula') {
        const answers: Record<string, unknown> = {}
        for (const reference of workspaceReferences(config.expression ?? '')) {
          const input = await evaluate(Number(reference.slice(1)), new Set(active))
          if (input.error) throw new Error('Unavailable input')
          answers[reference] = input.value
        }
        result = { value: workspaceFormula(config.expression ?? '', answers) }
      } else if (definition.kind === 'timer') {
        const timer = await req.payload.find({
          collection: 'task-countdowns',
          req,
          depth: 0,
          overrideAccess: true,
          limit: 1,
          where: { key: { equals: `${taskID}:${req.user!.id}:${id}` } },
        })
        const current = timer.docs[0]
        result = {
          value: current?.endsAt
            ? Math.max(0, Math.ceil((Date.parse(current.endsAt) - Date.now()) / 1000))
            : (current?.remainingSeconds ?? 0),
        }
      } else if (definition.kind === 'time-tracking') {
        timeTotal ??= workspaceDB(req)
          .prepare(
            'SELECT coalesce(sum(seconds),0) AS seconds FROM task_time_entries WHERE task_id=? AND ended_at IS NOT NULL',
          )
          .bind(taskID)
          .first<{ seconds: number }>()
        result = { value: (await timeTotal)?.seconds ?? 0 }
      } else if (definition.kind === 'lookup') {
        const source = await evaluate(Number(config.referenceField), new Set(active))
        if (source.error || !Array.isArray(source.value)) throw new Error('Unavailable reference')
        const looked = []
        for (const reference of source.value) {
          const target = await visibleReference(req, reference, cache)
          if (!target || !properties[reference.collection]?.includes(config.property ?? ''))
            throw new Error('Unavailable reference')
          looked.push(target[config.property!] ?? null)
        }
        result = { value: looked }
      } else {
        let value = values.get(id) ?? null
        if (definition.kind === 'reference' && Array.isArray(value)) {
          const redacted = []
          for (const reference of value as { collection: string; id: number }[]) {
            const target = await visibleReference(req, reference, cache)
            if (!target) throw new Error('Unavailable reference')
            redacted.push({ ...reference, label: target.title ?? target.name ?? `#${target.id}` })
          }
          value = redacted
        }
        result = { value }
      }
    } catch {
      result = { value: null, error: 'Unavailable input or invalid calculation' }
    }
    results.set(id, result)
    return result
  }
  const output = []
  for (const definition of definitions.values())
    output.push({ definition, ...(await evaluate(definition.id)) })
  return output
}
