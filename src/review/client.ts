export type Task = {
  id: number
  title: string
  description?: string
  documentType?: string | null
  documentID?: string | null
  documentTitle?: string
  documentDeleted?: boolean
  region?: string
  parent?: number
  status: string
  priority: string
  assignee?: number
  assigneeLabel?: string
  assigneePerson?: { id: number; label: string; username?: string; avatar?: string }
  collaborators?: number[]
  collaboratorPeople?: { id: number; label: string; username?: string; avatar?: string }[]
  creator?: number
  creatorLabel?: string
  dueDate?: string
  startDate?: string
  milestone?: boolean
  archived?: boolean
  boards?: number[]
  personal?: boolean
  updatedAt?: string
  createdAt?: string
  completedAt?: string | null
  canEdit?: boolean
  canComment?: boolean
  documentRestricted?: boolean
  mentions?: import('./mentions').Mention[]
}
export const statuses = {
  open: 'Open',
  'in-progress': 'In progress',
  'ready-for-review': 'Ready for review',
  done: 'Done',
}

/** D1 LIKE patterns allow 50 bytes, including the adapter's surrounding wildcards. */
export function taskSearchTerms(search: string) {
  const terms: string[] = []
  for (const word of search.trim().slice(0, 120).split(/\s+/)) {
    let chunk = ''
    for (const character of word) {
      if (new TextEncoder().encode(chunk + character).length > 40) {
        terms.push(chunk)
        chunk = ''
      }
      chunk += character
    }
    if (chunk) terms.push(chunk)
  }
  return terms
}
export async function reviewAPI<T>(
  api: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  if (method !== 'GET') path += `${path.includes('?') ? '&' : '?'}depth=0`
  const response = await fetch(`${api}/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await response.json()) as T & { errors?: { message?: string }[]; error?: string }
  if (!response.ok)
    throw Object.assign(
      new Error(
        data.errors?.[0]?.message ||
          data.error ||
          'Could not save review changes. Please try again.',
      ),
      { status: response.status },
    )
  return data
}
export const query = (where: object, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    where: JSON.stringify(where),
    depth: '0',
    limit: '50',
    sort: '-updatedAt',
    ...extra,
  })

export async function reviewAll<T>(
  api: string,
  collection: string,
  where: object,
  sort = 'createdAt',
) {
  const docs: T[] = []
  let page = 1,
    totalPages = 1
  do {
    const result = await reviewAPI<{ docs: T[]; totalPages: number }>(
      api,
      `${collection}?${query(where, { page: String(page), limit: '100', sort })}`,
    )
    docs.push(...result.docs)
    totalPages = result.totalPages
    page++
  } while (page <= totalPages)
  return docs
}
