import { APIError, type PayloadRequest, type Where } from 'payload'
import { canReviewCollection, isAdministrator, relationID, reviewDocuments } from './documents'
import { projectRole, projectWhere, roleRank } from './project-access'

/** Only server code can authorize changes to the shared task audience. */
export const workspaceWrite = Symbol('workspace-write')
export const internalWorkspace = (req: PayloadRequest) =>
  !!(req.context as Record<symbol, unknown>)[workspaceWrite]
export const workspaceContext = { [workspaceWrite]: true }
/** Payload mutates a passed local request. Keep server authority scoped to one internal operation. */
// The enumerable scope keeps Payload's empty-context optimization from dropping symbol keys.
// Only workspaceWrite grants authority; the string marker never authorizes a caller.
export const workspaceReq = (req: PayloadRequest) =>
  ({
    ...req,
    headers: req.headers,
    url: req.url,
    query: { ...req.query },
    context: { ...req.context, ...workspaceContext, workspaceScope: 'server' },
  }) as PayloadRequest
export const workspaceDB = (req: PayloadRequest) =>
  (req.payload.db as unknown as { client: D1Database }).client
export async function ensureWorkspaceGuards(req: PayloadRequest) {
  await workspaceDB(req)
    .prepare(
      'CREATE TABLE IF NOT EXISTS task_workspace_guards (id text PRIMARY KEY NOT NULL, valid integer NOT NULL CHECK (valid = 1))',
    )
    .run()
}
export const reject = (message: string, status = 403): never => {
  throw new APIError(message, status)
}
export const ids = (values: unknown): string[] =>
  Array.isArray(values) ? values.map(relationID) : []
export type BoardRole = 'owner' | 'editor' | 'commenter' | 'viewer'

/** Relationship joins keep access filtering in SQL, including native count operations. */
export function boardWhere(
  req: PayloadRequest,
  permission: 'read' | 'edit' | 'comment' | 'owner' = 'read',
  prefix = '',
  membershipJoin = 'memberships',
): Where {
  const id = req.user?.id
  if (!id) return { id: { equals: -1 } }
  const or: Where[] = [{ [`${prefix}owner`]: { equals: id } }]
  if (permission === 'owner')
    or.push({
      and: [
        { [`${prefix}inheritProject`]: { equals: true } },
        projectWhere(req, 'owner', `${prefix}project.`),
      ],
    })
  if (permission !== 'owner') {
    const field =
      permission === 'read' ? 'user' : permission === 'edit' ? 'editUser' : 'commentUser'
    or.push({ [`${prefix}${membershipJoin}.${field}`]: { equals: id } })
    if (permission === 'read') or.push({ [`${prefix}visibility`]: { equals: 'team' } })
    or.push({
      and: [
        { [`${prefix}inheritProject`]: { equals: true } },
        projectWhere(
          req,
          permission,
          `${prefix}project.`,
          membershipJoin === 'directMemberships' ? 'directProjectGrants' : 'projectGrants',
        ),
      ],
    })
  }
  return permission === 'read' || permission === 'owner'
    ? { or }
    : {
        and: [
          { or },
          { [`${prefix}archived`]: { not_equals: true } },
          {
            or: [
              { [`${prefix}project`]: { exists: false } },
              { [`${prefix}project.archived`]: { not_equals: true } },
            ],
          },
        ],
      }
}

export function taskWhere(
  req: PayloadRequest,
  permission: 'read' | 'edit' | 'comment' = 'read',
  prefix = '',
): boolean | Where {
  if (!req.user) return false
  if (isAdministrator(req))
    return permission === 'read'
      ? true
      : {
          or: [
            { [`${prefix}boards`]: { exists: false } },
            {
              and: [
                { [`${prefix}boards.archived`]: { not_equals: true } },
                {
                  or: [
                    { [`${prefix}boards.project`]: { exists: false } },
                    { [`${prefix}boards.project.archived`]: { not_equals: true } },
                  ],
                },
              ],
            },
          ],
        }
  const field = (key: string) => `${prefix}${key}`
  return {
    or: [
      boardWhere(req, permission, field('boards.')),
      {
        and: [
          { [field('boards')]: { exists: false } },
          {
            or: [
              {
                and: [
                  { [field('personal')]: { not_equals: true } },
                  {
                    [field('documentType')]: {
                      in: reviewDocuments.filter((type) => canReviewCollection(req, type)),
                    },
                  },
                  { [field('documentDeleted')]: { not_equals: true } },
                ],
              },
              {
                and: [
                  {
                    or: [
                      { [field('personal')]: { equals: true } },
                      { [field('documentType')]: { exists: false } },
                    ],
                  },
                  {
                    or: [
                      {
                        and: [
                          { [field('parent')]: { exists: false } },
                          {
                            or: [
                              { [field('creator')]: { equals: req.user.id } },
                              { [field('assignee')]: { equals: req.user.id } },
                            ],
                          },
                        ],
                      },
                      {
                        and: [
                          { [field('parent')]: { exists: true } },
                          {
                            or: [
                              { [field('parent.creator')]: { equals: req.user.id } },
                              { [field('parent.assignee')]: { equals: req.user.id } },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

export async function boardRole(req: PayloadRequest, id: unknown): Promise<BoardRole | null> {
  if (!req.user) return null
  const board = await req.payload.findByID({
    collection: 'task-boards',
    id: relationID(id),
    req,
    overrideAccess: true,
    depth: 0,
  })
  if (isAdministrator(req) || relationID(board.owner) === String(req.user.id)) return 'owner'
  const members = await req.payload.find({
    collection: 'task-board-memberships',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { and: [{ board: { equals: board.id } }, { user: { equals: req.user.id } }] },
  })
  const direct = members.docs[0]?.role ?? (board.visibility === 'team' ? 'viewer' : null)
  const inherited = board.inheritProject ? await projectRole(req, board.project) : null
  return direct && inherited
    ? roleRank[direct] >= roleRank[inherited]
      ? direct
      : inherited
    : (direct ?? inherited)
}

export async function requireBoard(
  req: PayloadRequest,
  id: unknown,
  permission: 'read' | 'edit' | 'owner' = 'read',
) {
  const role = await boardRole(req, id)
  if (permission === 'edit') {
    const board = await req.payload.findByID({
      collection: 'task-boards',
      id: relationID(id),
      req,
      overrideAccess: true,
      depth: 0,
    })
    if (board.archived) reject('Restore this board before editing it.', 400)
    if (board.project) {
      const project = await req.payload.findByID({
        collection: 'task-projects',
        id: relationID(board.project),
        req,
        overrideAccess: true,
        depth: 0,
      })
      if (project.archived) reject('Restore this project before editing its boards.', 409)
    }
  }
  if (
    !role ||
    (permission === 'edit' && !['owner', 'editor'].includes(role)) ||
    (permission === 'owner' && role !== 'owner')
  )
    reject('You do not have permission to change this board.')
  return role
}

export async function canTask(
  req: PayloadRequest,
  id: unknown,
  permission: 'read' | 'edit' | 'comment' = 'read',
) {
  const access = taskWhere(req, permission)
  if (!access) return false
  const result = await req.payload.count({
    collection: 'review-tasks',
    req,
    overrideAccess: true,
    where: { and: [{ id: { equals: relationID(id) } }, ...(access === true ? [] : [access])] },
  })
  return result.totalDocs > 0
}

export async function requireTask(
  req: PayloadRequest,
  id: unknown,
  permission: 'read' | 'edit' | 'comment' = 'read',
) {
  if (!(await canTask(req, id, permission)))
    reject('This task is unavailable or your permissions have changed.')
  return req.payload.findByID({
    collection: 'review-tasks',
    id: relationID(id),
    req,
    overrideAccess: true,
    depth: 0,
  })
}
