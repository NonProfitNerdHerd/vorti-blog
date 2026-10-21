import {
  APIError,
  type Config,
  type Field,
  type CollectionConfig,
  type CollectionSlug,
} from 'payload'
import { internalWorkspace, ids } from '../review/workspace-access'
import { authorityClaim } from './claims'
import { claimRequest } from './identity-authority'
import { cmsDatabase, migrationRequest } from './cms-scope'

const siteField = (name: string): Field => ({
  name,
  type: 'text',
  index: true,
  admin: { hidden: true },
  access: { create: () => false, update: () => false },
})
const protectedCollections = new Set([
  'task-projects',
  'task-boards',
  'review-tasks',
  'review-comments',
  'review-activity',
])
const projection: CollectionConfig = {
  slug: 'platform-workspace-access',
  dbName: 'vc_workspace_access',
  timestamps: false,
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'id', type: 'text', required: true },
    { name: 'board', type: 'relationship', relationTo: 'task-boards', index: true },
    { name: 'project', type: 'relationship', relationTo: 'task-projects', index: true },
    ...['readKey', 'editKey', 'commentKey', 'ownerKey'].map((name): Field => ({
      name,
      type: 'text',
      index: true,
    })),
  ],
  hooks: {
    beforeChange: [
      () => {
        throw new APIError('Workspace grants are database-derived.', 403)
      },
    ],
    beforeDelete: [
      () => {
        throw new APIError('Workspace grants are database-derived.', 403)
      },
    ],
  },
}
/** Audience predicates remain shared with counts, Dashboard, comments and notifications. */
export const tenantWorkspace = (config: Config): Config => ({
  ...config,
  collections: [
    ...(config.collections || []).map((collection): CollectionConfig => {
      if (!protectedCollections.has(collection.slug)) return collection
      const container = ['task-projects', 'task-boards'].includes(collection.slug)
      // Distinct join names avoid native SQL alias reuse across task.board, board and project
      // branches of the same Inbox predicate. These joins are authorization-only.
      const grantNames =
        collection.slug === 'task-boards'
          ? ['siteAccessGrants', 'taskSiteAccessGrants', 'directSiteAccessGrants']
          : ['projectSiteAccessGrants']
      return {
        ...collection,
        fields: [
          ...collection.fields,
          ...(container
            ? [
                siteField('platformSite'),
                ...grantNames.map((name): Field => ({
                  name,
                  type: 'join' as const,
                  collection: 'platform-workspace-access' as CollectionSlug,
                  on: collection.slug === 'task-boards' ? 'board' : 'project',
                  defaultLimit: 0,
                  maxDepth: 0,
                  access: { read: () => false },
                  admin: { hidden: true },
                })),
              ]
            : collection.slug === 'review-tasks'
              ? [siteField('documentSite')]
              : []),
        ],
        forceSelect: {
          ...collection.forceSelect,
          ...(container
            ? { platformSite: true }
            : collection.slug === 'review-tasks'
              ? { documentSite: true }
              : {}),
        },
        hooks: {
          ...collection.hooks,
          beforeOperation: [
            async ({ req, args, operation }) => {
              if (container && operation === 'read') {
                const readArgs = args as unknown as { joins?: false | Record<string, unknown> }
                if (readArgs.joins !== false)
                  readArgs.joins = {
                    ...readArgs.joins,
                    ...Object.fromEntries(grantNames.map((name) => [name, false])),
                  }
              }
              if (!migrationRequest(req)) {
                await claimRequest(req)
                if (
                  req.user &&
                  !internalWorkspace(req) &&
                  ['read', 'count', 'readDistinct', 'update', 'delete'].includes(operation)
                )
                  (args as unknown as { overrideAccess: boolean }).overrideAccess = false
              }
              return args
            },
            ...(collection.hooks?.beforeOperation || []),
          ],
          beforeValidate: [
            async ({ req, data, originalDoc, operation }) => {
              if (!data || migrationRequest(req)) return data
              const claim = await claimRequest(req)
              const name = container ? 'platformSite' : 'documentSite'
              if (name in data && data[name] !== originalDoc?.[name])
                throw new APIError('Workspace ownership is server-managed.', 403)
              if (container) {
                if (
                  originalDoc?.id &&
                  data.visibility === 'team' &&
                  originalDoc.visibility !== 'team'
                )
                  throw new APIError(
                    'Expanding a workspace audience requires reviewed sharing approval.',
                    403,
                  )
                if (operation === 'create')
                  data.platformSite = internalWorkspace(req) && data.starterKey ? null : claim?.site
                else data.platformSite = originalDoc.platformSite || null
                if (
                  data.platformSite &&
                  (data.platformSite !== claim?.site || !claim.allowed.workspace?.includes('edit'))
                )
                  throw new APIError('Workspace editing is unavailable in this site.', 403)
              } else if (collection.slug === 'review-tasks') {
                data.documentSite =
                  originalDoc?.documentSite ||
                  (data.documentType && data.documentType !== 'none' ? claim?.site : null)
              }
              return data
            },
            ...(collection.hooks?.beforeValidate || []),
          ],
          beforeChange: [
            ...(collection.hooks?.beforeChange || []),
            async ({ req, data, originalDoc }) => {
              if (migrationRequest(req)) return data
              const claim = authorityClaim(req.user),
                db = cmsDatabase(req)
              if (collection.slug === 'task-boards') {
                const project = data.project ?? originalDoc?.project
                if (project) {
                  const parent = await db
                    .prepare('SELECT platform_site FROM task_projects WHERE id=?')
                    .bind(typeof project === 'object' ? project.id : project)
                    .first<{ platform_site: string | null }>()
                  if (!parent) throw new APIError('Project unavailable.', 403)
                  if (originalDoc?.id) {
                    const prior =
                      typeof originalDoc.project === 'object'
                        ? originalDoc.project?.id
                        : originalDoc.project
                    if (
                      String(prior) !==
                        String(typeof project === 'object' ? project.id : project) &&
                      (originalDoc.platformSite || null) !== (parent.platform_site || null)
                    )
                      throw new APIError('Boards cannot move between site audiences.', 403)
                    data.platformSite = originalDoc.platformSite || null
                  } else
                    data.platformSite =
                      parent.platform_site || (data.visibility === 'team' ? claim?.site : null)
                }
              }
              if (collection.slug === 'review-tasks') {
                if (!originalDoc?.id && data.parent) {
                  const parent = typeof data.parent === 'object' ? data.parent.id : data.parent
                  const source = await db
                    .prepare('SELECT document_site FROM review_tasks WHERE id=?')
                    .bind(parent)
                    .first<{ document_site: string | null }>()
                  data.documentSite = source?.document_site || null
                }
                const boards = ids(data.boards ?? originalDoc?.boards),
                  audiences = new Set<string>()
                for (let offset = 0; offset < boards.length; offset += 75) {
                  const batch = boards.slice(offset, offset + 75)
                  const rows = await db
                    .prepare(
                      `SELECT id,platform_site FROM task_boards WHERE id IN(${batch.map(() => '?').join(',')})`,
                    )
                    .bind(...batch)
                    .all<{ id: number; platform_site: string | null }>()
                  if (rows.results.length !== batch.length)
                    throw new APIError('Board unavailable.', 403)
                  for (const row of rows.results) audiences.add(row.platform_site || '')
                }
                const changingAudience =
                  !originalDoc?.id || ids(originalDoc.boards).join(',') !== boards.join(',')
                if (
                  changingAudience &&
                  (audiences.size > 1 ||
                    (audiences.size === 1 &&
                      !audiences.has('') &&
                      !audiences.has(claim?.site || '__none__')))
                )
                  throw new APIError(
                    'Task sharing across site audiences requires a reviewed move.',
                    403,
                  )
              }
              return data
            },
          ],
        },
      }
    }),
    projection,
  ],
})
