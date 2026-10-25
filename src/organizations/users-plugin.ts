import {
  type CollectionConfig,
  type CollectionSlug,
  type Config,
  type PayloadRequest,
  type Where,
} from 'payload'
import { OrganizationRepository } from './repository'
import { cmsDatabase, cmsScope, migrationRequest } from './cms-scope'
import { identityAuthority } from './identity-authority'
import { withAuthority } from './claims'
import { formCapabilities } from '../forms/access'
import { mutationFence } from './mutation-guards'
const directoryList = Symbol('account-directory-list')

async function installed(req: PayloadRequest): Promise<boolean> {
  return !!(await cmsDatabase(req)
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vc_organizations'")
    .first())
}
export async function installationOperator(req: PayloadRequest, user = req.user): Promise<boolean> {
  if (!user || migrationRequest(req)) return false
  if (!(await installed(req))) return user.role === 'administrator'
  return new OrganizationRepository(cmsDatabase(req), Number(user.id)).isOperator()
}
const directory: CollectionConfig = {
  slug: 'platform-user-sites',
  dbName: 'vc_user_sites',
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'id', type: 'text', required: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'site', type: 'text', required: true },
    { name: 'enabled', type: 'checkbox', required: true },
  ],
  timestamps: false,
  indexes: [{ fields: ['user', 'site'], unique: true }, { fields: ['site', 'enabled', 'user'] }],
}
/** Accounts are installation-owned; site administrators manage memberships, not arbitrary accounts. */
export const tenantUsers = (config: Config): Config => ({
  ...config,
  collections: [
    ...(config.collections || []).map((collection) => {
      if (collection.slug !== 'users') return collection
      return {
        ...collection,
        fields: [
          ...collection.fields.map((field) =>
            field.type === 'select' && field.name === 'role'
              ? {
                  ...field,
                  access: {
                    ...field.access,
                    create: async ({ req }: { req: PayloadRequest }) =>
                      !req.user || (await installationOperator(req)),
                    update: async ({ req }: { req: PayloadRequest }) => installationOperator(req),
                  },
                }
              : field,
          ),
          {
            name: 'platformOperator',
            type: 'checkbox',
            virtual: true,
            admin: { hidden: true },
            access: { create: () => false, update: () => false },
          },
          {
            name: 'platformForms',
            type: 'json',
            virtual: true,
            admin: { hidden: true },
            access: { create: () => false, update: () => false },
          },
          {
            name: 'platformAuthority',
            type: 'json',
            virtual: true,
            admin: { hidden: true },
            access: { create: () => false, update: () => false },
          },
          {
            name: 'siteDirectory',
            type: 'join',
            collection: 'platform-user-sites' as CollectionSlug,
            on: 'user',
            // SQL predicates use this join, but authentication must never
            // hydrate its internal composite IDs into account responses.
            maxDepth: 0,
            admin: { hidden: true },
            access: { read: () => false },
          },
        ],
        access: {
          ...collection.access,
          create: async ({ req }) =>
            (await installationOperator(req)) ||
            (!req.user &&
              (await req.payload.count({ collection: 'users', overrideAccess: true })).totalDocs ===
                0),
          read: async ({ req }) => {
            if (!req.user) return false
            if (migrationRequest(req) || (await installationOperator(req))) return true
            const own: Where = { id: { equals: req.user.id } }
            if (!(await installed(req))) return true // Pre-upgrade compatibility installation has only one audience.
            try {
              const scope = await cmsScope(req, 'read')
              return {
                or: [
                  own,
                  {
                    and: [
                      { 'siteDirectory.site': { equals: scope.site } },
                      { 'siteDirectory.enabled': { equals: true } },
                    ],
                  },
                ],
              }
            } catch (error) {
              if (
                error &&
                typeof error === 'object' &&
                'status' in error &&
                [403, 404].includes(Number(error.status))
              )
                return own
              throw error
            }
          },
          update: async ({ req }) =>
            (await installationOperator(req))
              ? true
              : req.user
                ? { id: { equals: req.user.id } }
                : false,
          delete: async ({ req }) => installationOperator(req),
        },
        hooks: {
          ...collection.hooks,
          beforeOperation: [
            async ({ req, args, operation }) => {
              if (operation === 'read')
                (req.context as Record<symbol, unknown>)[directoryList] =
                  !('id' in args) && (!('limit' in args) || args.limit !== 1)
              // The directory join is only a SQL access predicate, never account response data.
              if (operation === 'read') (args as unknown as { joins: false }).joins = false
              if (
                req.user &&
                !migrationRequest(req) &&
                ['create', 'read', 'count', 'readDistinct', 'update', 'delete'].includes(operation)
              )
                (args as unknown as { overrideAccess: boolean }).overrideAccess = false
              // Read-only virtual values may round-trip through the native Account form. They are
              // discarded and always derived again, never accepted as authority or membership.
              if ('data' in args && args.data && typeof args.data === 'object') {
                delete (args.data as Record<string, unknown>).platformOperator
                delete (args.data as Record<string, unknown>).platformForms
                delete (args.data as Record<string, unknown>).platformAuthority
                delete (args.data as Record<string, unknown>).siteDirectory
              }
              return args
            },
            ...(collection.hooks?.beforeOperation || []),
          ],
          afterRead: [
            ...(collection.hooks?.afterRead || []),
            async ({ doc, req }) => {
              delete doc.siteDirectory
              if (migrationRequest(req)) return doc
              if (
                (!req.user && !(req.context as Record<symbol, unknown>)[directoryList]) ||
                String(req.user?.id) === String(doc.id)
              ) {
                const claim = await identityAuthority(req, doc)
                const permissions = Object.entries(formCapabilities)
                  .filter(([, [category, operation]]) =>
                    claim.allowed[category]?.includes(operation),
                  )
                  .map(([permission]) => permission)
                return withAuthority(
                  {
                    ...doc,
                    platformOperator: claim.operator,
                    platformForms: permissions.length ? [{ site: claim.site, permissions }] : [],
                  },
                  claim,
                )
              }
              return {
                ...doc,
                platformOperator: await installationOperator(req, doc as typeof req.user),
              }
            },
          ],
          afterChange: [
            ...(collection.hooks?.afterChange || []),
            async ({ doc, req, operation }) => {
              if (
                operation !== 'create' ||
                !req.user ||
                !(await installed(req)) ||
                !(await installationOperator(req))
              )
                return doc
              const scope = await cmsScope(req, 'configure'),
                db = cmsDatabase(req)
              // A failed provisioning attempt leaves an unassigned account, never an implicitly privileged one.
              const role = doc.role === 'administrator' ? 'administrator' : 'reader'
              const operations = [
                'read',
                'edit',
                'publish',
                'export',
                ...(['administrator', 'designer'].includes(doc.role) ? ['configure'] : []),
              ]
              await db.batch([
                ...(await mutationFence(req)),
                db
                  .prepare(
                    'INSERT OR IGNORE INTO vc_site_memberships(site_id,user_id,role) VALUES(?,?,?)',
                  )
                  .bind(scope.site, doc.id, role),
                ...operations.map((operation) =>
                  db
                    .prepare(
                      "INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation) VALUES(?,?,'content',?)",
                    )
                    .bind(scope.site, doc.id, operation),
                ),
                db
                  .prepare(
                    "INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation) VALUES(?,?,'workspace','edit')",
                  )
                  .bind(scope.site, doc.id),
                ...(['designer'].includes(doc.role)
                  ? [
                      db
                        .prepare(
                          "INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation) VALUES(?,?,'forms','edit')",
                        )
                        .bind(scope.site, doc.id),
                      db
                        .prepare(
                          "INSERT OR IGNORE INTO vc_member_capabilities(site_id,user_id,category,operation) VALUES(?,?,'forms','publish')",
                        )
                        .bind(scope.site, doc.id),
                      db
                        .prepare(
                          "INSERT OR IGNORE INTO vc_member_restrictions(site_id,user_id,category,operation) VALUES(?,?,'form-submissions','read')",
                        )
                        .bind(scope.site, doc.id),
                    ]
                  : []),
                db
                  .prepare(
                    'INSERT OR IGNORE INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                  )
                  .bind(
                    crypto.randomUUID(),
                    scope.organization,
                    scope.site,
                    req.user.id,
                    'account.provisioned',
                    'user',
                    String(doc.id),
                    JSON.stringify({ role, content: operations }),
                    `account-provision:${doc.id}:${scope.site}`,
                    new Date().toISOString(),
                  ),
              ])
              return doc
            },
          ],
        },
      } satisfies CollectionConfig
    }),
    directory,
  ],
})
