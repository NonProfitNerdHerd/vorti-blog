import type { PayloadRequest, Where } from 'payload'
import { isAdministrator, relationID } from './documents'
import { reject, type BoardRole } from './workspace-access'

export const roleRank = { viewer: 1, commenter: 2, editor: 3, owner: 4 } as const
export function projectWhere(
  req: PayloadRequest,
  permission: 'read' | 'edit' | 'comment' | 'owner' = 'read',
  prefix = '',
  join = 'projectGrants',
): Where {
  const user = req.user?.id ?? -1
  const or: Where[] = [{ [`${prefix}owner`]: { equals: user } }]
  if (permission !== 'owner') {
    const field =
      permission === 'read' ? 'user' : permission === 'edit' ? 'editUser' : 'commentUser'
    or.push({ [`${prefix}${join}.${field}`]: { equals: user } })
    if (permission === 'read') or.push({ [`${prefix}visibility`]: { equals: 'team' } })
  }
  return permission === 'read' || permission === 'owner'
    ? { or }
    : { and: [{ or }, { [`${prefix}archived`]: { not_equals: true } }] }
}
export async function projectRole(req: PayloadRequest, id: unknown): Promise<BoardRole | null> {
  if (!req.user || !relationID(id)) return null
  const project = await req.payload.findByID({
    collection: 'task-projects',
    id: relationID(id),
    req,
    depth: 0,
    overrideAccess: true,
  })
  if (isAdministrator(req) || relationID(project.owner) === String(req.user.id)) return 'owner'
  const result = await req.payload.find({
    collection: 'task-project-memberships',
    req,
    depth: 0,
    overrideAccess: true,
    limit: 1,
    where: { and: [{ project: { equals: project.id } }, { user: { equals: req.user.id } }] },
  })
  return result.docs[0]?.role ?? (project.visibility === 'team' ? 'viewer' : null)
}
export async function requireProject(
  req: PayloadRequest,
  id: unknown,
  permission: 'read' | 'edit' | 'owner' = 'read',
) {
  const role = await projectRole(req, id)
  if (
    !role ||
    (permission === 'edit' && roleRank[role] < 3) ||
    (permission === 'owner' && role !== 'owner')
  )
    reject('This project is unavailable or your permissions have changed.')
  const project = await req.payload.findByID({
    collection: 'task-projects',
    id: relationID(id),
    req,
    depth: 0,
    overrideAccess: true,
  })
  if (permission === 'edit' && project.archived) reject('Restore this project before editing.', 409)
  return project
}
