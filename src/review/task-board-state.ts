import type { Task } from './client'

/** Reports can finish after a write that began while their first page was visible. */
export function reconcileTaskSnapshot<T extends Task>(
  current: T[],
  incoming: T[],
  pending: ReadonlySet<number>,
  created: ReadonlySet<number>,
) {
  const existing = new Map(current.map((task) => [task.id, task]))
  const seen = new Set(incoming.map((task) => task.id))
  return [
    ...incoming.map((task) => {
      const local = existing.get(task.id)
      return local && (pending.has(task.id) || (local.updatedAt ?? '') > (task.updatedAt ?? ''))
        ? local
        : task
    }),
    ...current.filter((task) => !seen.has(task.id) && (task.id < 0 || created.has(task.id))),
  ]
}
