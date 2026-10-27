import type { PayloadRequest, Where } from 'payload'
import { isAdministrator, relationID } from './documents'
import { reject, workspaceReq, type BoardRole } from './workspace-access'
import { workspaceGrantWhere } from '../organizations/workspace-scope'
import { claimRequest } from '../organizations/identity-authority'
import { authorityClaim } from '../organizations/claims'

export const roleRank = { viewer: 1, commenter: 2, editor: 3, owner: 4 } as const
export function projectWhere(
  req: PayloadRequest,
  permission: 'read' | 'edit' | 'comment' | 'owner' = 'read',
  prefix = '',
  _join = 'projectGrants',
): Where {
  return workspaceGrantWhere(req, permission, prefix, 'projectSiteAccessGrants')
}
export async function projectRole(req: PayloadRequest, id: unknown): Promise<BoardRole | null> {
  if (!req.user || !relationID(id)) return null
  const claim = await claimRequest(req)
  const project = await req.payload.findByID({
    collection: 'task-projects',
    id: relationID(id),
    req: workspaceReq(req),
    depth: 0,
    overrideAccess: true,
  })
  if (isAdministrator(req)) return 'owner'
  if (claim?.permissions) {
    if ((project as unknown as { creationTenant?: string }).creationTenant !== claim.organization || !claim.permissions.includes('tasks:read')) return null
  }
  if (project.platformSite && (project.platformSite !== claim?.site || !claim.allowed.workspace?.includes('read'))) return null
  if (relationID(project.owner) === String(req.user.id)) return 'owner'
  if (claim?.tenantAdministrator) return 'viewer'
  const result = await req.payload.find({
    collection: 'task-project-memberships',
    req: workspaceReq(req),
    depth: 0,
    overrideAccess: true,
    limit: 1,
    where: { and: [{ project: { equals: project.id } }, { user: { equals: req.user.id } }] },
  })
  return result.docs[0]?.role ?? (project.visibility === 'team' && project.platformSite === claim?.site && claim.allowed.workspace?.includes('read') ? 'viewer' : null)
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
  if (permission !== 'read' && project.platformSite && !authorityClaim(req.user)?.allowed.workspace?.includes('edit')) reject('Workspace editing is unavailable in this site.')
  if (permission === 'edit' && project.archived) reject('Restore this project before editing.', 409)
  return project
}
