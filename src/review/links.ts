export function taskDocumentLink(
  task: { documentType: string; documentID: string; id: string | number; region?: string },
  admin = '/admin',
) {
  const query = new URLSearchParams({ task: String(task.id) })
  if (task.region && task.region !== 'document') query.set('reviewRegion', task.region)
  return `${admin}/collections/${encodeURIComponent(task.documentType)}/${encodeURIComponent(task.documentID)}?${query}`
}
