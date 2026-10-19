import type { Where } from 'payload'

export const activeProjects: Where = { archived: { not_equals: true } }
export const activeBoards: Where = {
  and: [
    activeProjects,
    { or: [{ project: { exists: false } }, { 'project.archived': { not_equals: true } }] },
  ],
}
