import { APIError, type Config } from 'payload'
/** Only server-owned migration tools can supply this symbol; JSON context cannot impersonate it. */
export const PLATFORM_MIGRATION = Symbol('trusted-platform-migration')
async function checkRequest(
  db: D1Database,
  req: { user?: { id: number | string }; context?: object },
): Promise<void> {
  if ((req.context as Record<symbol, unknown> | undefined)?.[PLATFORM_MIGRATION] === true) return
  await requireActiveAccount(db, req.user)
}

/** Request-time status lookup. Never trust a role, cookie snapshot, or client flag for deactivation. */
export async function requireActiveAccount(
  db: D1Database,
  user: { id: number | string } | null | undefined,
): Promise<void> {
  if (!user) return
  const actor = Number(user.id)
  if (!Number.isSafeInteger(actor) || actor < 1) throw new APIError('Account unavailable.', 403)
  try {
    const status = await db
      .prepare('SELECT disabled FROM vc_account_status WHERE user_id=?')
      .bind(actor)
      .first<{ disabled: number }>()
    if (status?.disabled === 1)
      throw new APIError('This account is inactive. Contact an installation operator.', 403)
  } catch (error) {
    if (error instanceof APIError) throw error
    // Fresh development/bootstrap databases have no organization schema yet. A partially migrated
    // authority database must fail closed, rather than ignoring an unavailable status table.
    if (error instanceof Error && /no such table:.*vc_account_status/i.test(error.message)) {
      const installed = await db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vc_organizations'")
        .first()
      if (!installed) return
    }
    throw new APIError('Account permissions are temporarily unavailable.', 503)
  }
}

/** Apply last, after modules register collections, globals and endpoints. No dependency patches. */
export const accountStatusGuards =
  (db: D1Database) =>
  (config: Config): Config => {
    const guardEndpoints = (endpoints: NonNullable<Config['endpoints']>) =>
      endpoints.map((endpoint) => ({
        ...endpoint,
        handler: async (...args: Parameters<typeof endpoint.handler>) => {
          await requireActiveAccount(db, args[0].user)
          return endpoint.handler(...args)
        },
      }))
    return {
      ...config,
      endpoints: guardEndpoints(config.endpoints || []),
      collections: (config.collections || []).map((collection) => ({
        ...collection,
        endpoints:
          collection.endpoints === false ? false : guardEndpoints(collection.endpoints || []),
        hooks: {
          ...collection.hooks,
          beforeOperation: [
            async ({ req }) => {
              await checkRequest(db, req)
            },
            ...(collection.hooks?.beforeOperation || []),
          ],
          ...(collection.auth
            ? {
                beforeLogin: [
                  async ({ user }) => {
                    await requireActiveAccount(db, user)
                  },
                  ...(collection.hooks?.beforeLogin || []),
                ],
              }
            : {}),
        },
      })),
      globals: (config.globals || []).map((global) => ({
        ...global,
        endpoints: global.endpoints === false ? false : guardEndpoints(global.endpoints || []),
        hooks: {
          ...global.hooks,
          beforeRead: [
            async ({ req }) => {
              await checkRequest(db, req)
            },
            ...(global.hooks?.beforeRead || []),
          ],
          beforeChange: [
            async ({ req, data }) => {
              await checkRequest(db, req)
              return data
            },
            ...(global.hooks?.beforeChange || []),
          ],
        },
      })),
    }
  }
