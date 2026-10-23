import { APIError } from 'payload'

const privatePath = (path: string) =>
  path
    .split(/[^a-zA-Z0-9_]+/)
    .some((part) => part === 'platformMutationProof' || part === 'platform_mutation_proof')
const denied = () => {
  throw new APIError('Commit authority is not a queryable record field.', 403)
}

/** Redaction alone does not prevent inference through counts, filters, sorts, or joins.
 * Apply to every collection, including unguarded parents with relationships to guarded records. */
export function rejectMutationProofQuery(input: unknown): void {
  const where = (value: unknown) => {
    const pending = [value],
      visited = new WeakSet<object>()
    while (pending.length) {
      const node = pending.pop()
      if (!node || typeof node !== 'object' || visited.has(node)) continue
      visited.add(node)
      if (Array.isArray(node)) {
        pending.push(...node)
        continue
      }
      for (const [name, criterion] of Object.entries(node)) {
        if (privatePath(name)) denied()
        if (name === 'and' || name === 'or') pending.push(criterion)
      }
    }
  }
  const select = (value: unknown) => {
    const pending = [value],
      visited = new WeakSet<object>()
    while (pending.length) {
      const node = pending.pop()
      if (!node || typeof node !== 'object' || visited.has(node)) continue
      visited.add(node)
      for (const [name, selected] of Object.entries(node)) {
        if (selected !== false && privatePath(name)) denied()
        pending.push(selected)
      }
    }
  }
  const configurations = [input],
    visited = new WeakSet<object>()
  while (configurations.length) {
    const current = configurations.pop()
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    const args = current as {
      where?: unknown
      sort?: unknown
      select?: unknown
      joins?: unknown
      field?: unknown
    }
    where(args.where)
    select(args.select)
    const sorts = Array.isArray(args.sort) ? args.sort : [args.sort]
    for (const sort of sorts) if (typeof sort === 'string' && privatePath(sort)) denied()
    if (typeof args.field === 'string' && privatePath(args.field)) denied()
    if (args.joins && typeof args.joins === 'object')
      configurations.push(...Object.values(args.joins))
  }
}
