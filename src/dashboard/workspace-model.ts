import type { Where } from 'payload'

export const activeProjects: Where = { archived: { not_equals: true } }
export const activeBoards: Where = {
  and: [
    activeProjects,
    { or: [{ project: { exists: false } }, { 'project.archived': { not_equals: true } }] },
  ],
}

/** Dashboard containers belong to this site; personal containers remain personal. */
export function dashboardRequestPath(path: string, site: string): string {
  const [pathname, search = ''] = path.split('?')
  if (!/^(task-projects|task-boards)(\/count)?$/.test(pathname)) return path
  const params = new URLSearchParams(search)
  const where = params.has('where') ? JSON.parse(params.get('where')!) : {}
  params.set('where', JSON.stringify({ and: [where, { or: [
    { platformSite: { equals: site } }, { platformSite: { exists: false } },
  ] }] }))
  return pathname + '?' + params
}
