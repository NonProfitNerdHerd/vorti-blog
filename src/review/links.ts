export function taskDocumentLink(
  task: {
    documentType?: string | null
    documentID?: string | null
    id: string | number
    region?: string
  },
  admin = '/admin',
) {
  if (!task.documentType || !task.documentID)
    return `${admin}/collections/review-tasks?task=${encodeURIComponent(task.id)}`
  const query = new URLSearchParams({ task: String(task.id) })
  if (task.region && task.region !== 'document') query.set('reviewRegion', task.region)
  return `${admin}/collections/${encodeURIComponent(task.documentType)}/${encodeURIComponent(task.documentID)}?${query}`
}
