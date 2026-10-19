import { query, reviewAPI, type Task } from './client'
import { taskFiltersWhere, taskPresetFilters } from './dashboard-model'

export async function loadPersonalTasks(api: string, userID: string, today: string) {
  const filters = taskPresetFilters('assigned', userID),
    where = taskFiltersWhere(filters, today)
  const counts = await Promise.all(
    (['', 'overdue', 'soon'] as const).map((due) =>
      reviewAPI<{ totalDocs: number }>(
        api,
        `review-tasks/count?${query(taskFiltersWhere({ ...filters, due }, today))}`,
      ),
    ),
  )
  const dated = await reviewAPI<{ docs: Task[] }>(
    api,
    `review-tasks?${query({ and: [where, { dueDate: { exists: true } }] }, { limit: '5', sort: 'dueDate,-updatedAt' })}`,
  )
  let docs = dated.docs
  if (docs.length < 5)
    docs = [
      ...docs,
      ...(
        await reviewAPI<{ docs: Task[] }>(
          api,
          `review-tasks?${query({ and: [where, { dueDate: { exists: false } }] }, { limit: String(5 - docs.length) })}`,
        )
      ).docs,
    ]
  return { docs, counts: counts.map((count) => count.totalDocs) }
}
