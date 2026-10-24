import { PUBLIC_SITE_HEADER, PUBLIC_PREVIEW_HEADER, publicWebsite } from './public-website'
import { APIError, type PayloadRequest } from 'payload'
import { OrganizationRepository } from './repository'
import type { SiteOperation } from './policy'
import { PLATFORM_MIGRATION } from './account-guards'

// Payload's cached config and Next's API/RSC bundles can load separate module instances.
// Registry symbols bridge those server instances; JSON cannot construct symbol keys.
export const CMS_SITE = Symbol.for('vorticause.server-selected-cms-site')
export const CMS_MENU_RENDER = Symbol.for('vorticause.server-menu-render')
export const CMS_DERIVED_READ = Symbol.for('vorticause.server-derived-content-read')
const requestState = Symbol.for('vorticause.validated-cms-request')
export const cmsSiteContext = (site: string) => ({ cmsOperation: 'site-scoped', [CMS_SITE]: site })
export interface CMSScope {
  site: string
  organization: string
  epoch: number
  actor: number | null
  bootstrap: boolean
}
interface State {
  actor: number | null
  site: string
  bootstrap?: boolean
  scopes: Map<SiteOperation, Promise<CMSScope>>
}
type Context = Record<string | symbol, unknown>
export const migrationRequest = (req: PayloadRequest): boolean =>
  (req.context as Context)?.[PLATFORM_MIGRATION] === true

export function cmsDatabase(req: PayloadRequest): D1Database {
  const adapter = req.payload.db as unknown as {
    client?: D1Database
    drizzle?: { $client?: D1Database }
  }
  const db = adapter.client || adapter.drizzle?.$client
  if (!db?.prepare) throw new APIError('Site permissions are temporarily unavailable.', 503)
  return db
}
function siteID(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new APIError('Choose a valid site context.', 400)
  return value
}
/** Site context selects a target; it never grants authority. Symbols originate only in server code. */
export async function cmsScope(req: PayloadRequest, operation: SiteOperation): Promise<CMSScope> {
  const db = cmsDatabase(req),
    context = req.context as Context
  // Payload treats symbol-only contexts as empty when nesting a Local API call.
  // This marker preserves the symbol state; it never authorizes an operation.
  context.cmsOperation ||= 'site-scoped'
  let actor = req.user ? Number(req.user.id) : null
  if (actor !== null && (!Number.isSafeInteger(actor) || actor < 1))
    throw new APIError('Site unavailable.', 403)
  let routeHeaders: Headers | undefined
  try {
    routeHeaders = await (await import('next/headers')).headers()
  } catch {
    /* Native Local API calls may have no Next request. */
  }
  const publicSite =
    req.headers?.get(PUBLIC_SITE_HEADER) ||
    (!context[CMS_SITE] ? routeHeaders?.get(PUBLIC_SITE_HEADER) : null)
  const preview =
    (req.headers?.get(PUBLIC_PREVIEW_HEADER) || routeHeaders?.get(PUBLIC_PREVIEW_HEADER)) === '1'
  const publicFile =
    operation === 'read' &&
    !!req.url &&
    /^\/(?:sites\/[a-zA-Z0-9_-]+\/)?api\/media\/file(?:\/|$)/.test(new URL(req.url).pathname)
  // Media file URLs are public website destinations. A staff member's preference
  // must not retarget an image request; private workspace files use other routes.
  if (publicFile && !preview) {
    req.user = null
    actor = null
  }
  if (!actor && preview) {
    const authenticated = (await req.payload.auth({ headers: routeHeaders || req.headers })).user
    if (!authenticated) throw new APIError('Site unavailable.', 404)
    req.user = authenticated
    actor = Number(authenticated.id)
  }
  if (publicSite && !(await publicWebsite(db, publicSite, preview && actor !== null)))
    throw new APIError('Site unavailable.', 404)
  const explicit = publicFile
    ? publicSite || 'default'
    : (context[CMS_SITE] ?? publicSite ?? (actor ? req.headers?.get('x-vorticause-site') || routeHeaders?.get('x-vorticause-site') : null))
  let states = context[requestState] as Map<string, Promise<State>> | undefined
  if (!states) {
    states = new Map()
    context[requestState] = states
  }
  const key = `${actor ?? 'public'}:${explicit ? siteID(explicit) : 'stored'}`
  let pending = states.get(key)
  if (!pending) {
    pending = (async (): Promise<State> => {
      let selected = explicit ? siteID(explicit) : 'default'
      // Bootstrap may have no organization schema. Never infer access to another tenant from a role.
      const tables = (
        await db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN('vc_organizations','vc_member_capabilities')",
          )
          .all<{ name: string }>()
      ).results
      if (!tables.length) {
        if (selected !== 'default') throw new APIError('Site unavailable.', 403)
        return { site: 'default', actor, bootstrap: true, scopes: new Map() }
      }
      if (tables.length !== 2) throw new APIError('Site ownership migrations are pending.', 503)
      if (!explicit && actor) {
        const stored = await db
          .prepare('SELECT site_id FROM vc_site_contexts WHERE user_id=?')
          .bind(actor)
          .first<{ site_id: string }>()
        if (stored) selected = siteID(stored.site_id)
      }
      return { actor, site: selected, scopes: new Map() }
    })()
    // Install the promise before the first await. Native permission discovery evaluates
    // collections concurrently; each operation must share one initialization/authority load.
    states.set(key, pending)
  }
  const state = await pending
  if (state.bootstrap)
    return { site: 'default', organization: 'default', epoch: 0, actor, bootstrap: true }
  let scope = state.scopes.get(operation)
  if (!scope) {
    const selected = state.site
    if (!actor && selected !== 'default' && !(await publicWebsite(db, selected)))
      throw new APIError('Site unavailable.', 404)
    scope = (async (): Promise<CMSScope> => {
      if (actor) {
        const site = await new OrganizationRepository(db, actor).require(
          selected,
          'content',
          operation,
        )
        return {
          site: site.id,
          organization: site.organization_id,
          epoch: site.authorityRevision,
          actor,
          bootstrap: false,
        }
      }
      if (operation !== 'read') throw new APIError('Sign in to change content.', 403)
      const site = await db
        .prepare(
          `SELECT s.id,s.organization_id,o.authority_revision FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id
        WHERE s.id=? AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry a JOIN vc_sites p ON p.id=a.ancestor_id WHERE a.descendant_id=s.id AND p.archived=1)`,
        )
        .bind(selected)
        .first<{ id: string; organization_id: string; authority_revision: number }>()
      if (!site) throw new APIError('Site unavailable.', 404)
      return {
        site: site.id,
        organization: site.organization_id,
        epoch: site.authority_revision,
        actor: null,
        bootstrap: false,
      }
    })()
    state.scopes.set(operation, scope)
  }
  return scope
}
/** Complete a read under the same authority epoch; never deliver a result after revocation. */
export async function confirmCMSScope(req: PayloadRequest, scope: CMSScope): Promise<void> {
  if (scope.bootstrap || migrationRequest(req)) return
  const current = await cmsDatabase(req)
    .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
    .bind(scope.organization)
    .first<{ authority_revision: number }>()
  if (current?.authority_revision !== scope.epoch)
    throw new APIError('Site permissions changed. Reload and try again.', 403)
}
