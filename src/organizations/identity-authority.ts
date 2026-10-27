import { APIError, type PayloadRequest } from 'payload'
import { cmsDatabase, CMS_SITE, migrationRequest } from './cms-scope'
import { OrganizationRepository } from './repository'
import { withAuthority, authorityClaim, type AuthorityClaim } from './claims'
import type { SiteOperation } from './policy'

// Only capability metadata is cached. Keys include actor, site, authority epoch and deactivation;
// each use checks current primary-D1 authority first. Never cache records or CRM output here.
const caches = new WeakMap<D1Database, Map<string, { claim: AuthorityClaim; until: number }>>()
const installedDatabases = new WeakSet<D1Database>()
const requestEpochs = Symbol.for('vorticause.request-authority-epochs')
export async function identityAuthority(
  req: PayloadRequest,
  user: { id: string | number; role?: string },
  requestedSite?: string,
): Promise<AuthorityClaim> {
  const db = cmsDatabase(req),
    actor = Number(user.id)
  let cache = caches.get(db)
  if (!cache) {
    cache = new Map()
    caches.set(db, cache)
  }
  if (!Number.isSafeInteger(actor) || actor < 1) throw new APIError('Account unavailable.', 403)
  const installed =
    installedDatabases.has(db) ||
    (await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vc_organizations'")
      .first())
  if (!installed) {
    const admin = user.role === 'administrator',
      designer = user.role === 'designer'
    if (requestedSite && requestedSite !== 'default') throw new APIError('Site unavailable.', 403)
    const all: SiteOperation[] = ['read', 'edit', 'publish', 'export', 'configure']
    return {
      actor,
      site: 'default',
      organization: 'default',
      epoch: 0,
      operator: admin,
      bootstrap: true,
      allowed: {
        content: admin || designer ? all : ['read', 'edit', 'publish', 'export'],
        workspace: ['read', 'edit'],
        forms: admin ? all : designer ? ['read', 'edit', 'publish'] : [],
        'form-submissions': admin ? all : user.role === 'editor' ? ['read'] : [],
      },
    }
  }
  installedDatabases.add(db)
  let selected =
    requestedSite ||
    (req.context as Record<symbol, unknown>)[CMS_SITE] ||
    req.headers?.get('x-vorticause-site')
  if (!selected) {
    try { selected = (await (await import('next/headers')).headers()).get('x-vorticause-site') || undefined }
    catch { /* Non-HTTP jobs keep their explicitly supplied context or saved preference. */ }
  }
  if (!selected)
    selected =
      (
        await db
          .prepare('SELECT site_id FROM vc_site_contexts WHERE user_id=?')
          .bind(actor)
          .first<{ site_id: string }>()
      )?.site_id || 'default'
  if (typeof selected !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(selected))
    throw new APIError('Choose a valid site context.', 400)
  const current = await db
    .prepare(
      `SELECT s.organization_id,o.authority_revision,COALESCE(a.disabled,0) AS disabled FROM vc_sites s JOIN vc_organizations o ON o.id=s.organization_id
    LEFT JOIN vc_account_status a ON a.user_id=? WHERE s.id=?`,
    )
    .bind(actor, selected)
    .first<{ organization_id: string; authority_revision: number; disabled: number }>()
  if (!current) throw new APIError('Site unavailable.', 403)
  if (current.disabled)
    return {
      actor,
      site: selected,
      organization: current.organization_id,
      epoch: current.authority_revision,
      operator: false,
      bootstrap: false,
      allowed: {},
    }
  const key = `${actor}:${selected}:${current.authority_revision}`,
    existing = cache.get(key)
  // The fresh primary-D1 epoch/status read above validates an immutable cached matrix.
  // Only a paginated rebuild needs the second epoch fence below.
  if (existing && existing.until > Date.now()) return existing.claim
  let claim = existing && existing.until > Date.now() ? existing.claim : null
  if (!claim) {
    const result = await new OrganizationRepository(db, actor).authoritySet(selected)
    claim = {
      actor,
      site: selected,
      organization: result.site.organization_id,
      epoch: result.authorityRevision,
      operator: result.operator,
      tenantAdministrator: result.tenantAdministrator,
      permissions: result.permissions,
      bootstrap: false,
      allowed: result.allowed,
    }
    if (result.tenantAdministrator) {
      const available = await db.prepare(`SELECT s.id,f.feature FROM vc_sites s
        JOIN vc_tenant_features f ON f.tenant_id=s.organization_id AND f.available=1
        WHERE s.organization_id=? AND s.archived=0
        AND NOT EXISTS(SELECT 1 FROM vc_site_ancestry a JOIN vc_sites p ON p.id=a.ancestor_id WHERE a.descendant_id=s.id AND p.archived=1)
        AND COALESCE((SELECT v.value FROM vc_site_features v JOIN vc_site_ancestry a ON a.ancestor_id=v.site_id WHERE a.descendant_id=s.id AND v.feature=f.feature AND v.value<>'inherit' ORDER BY a.distance LIMIT 1),'enabled')='enabled'`)
        .bind(claim.organization).all<{id: string; feature: string}>()
      claim.featureSites = {}
      for (const row of available.results) (claim.featureSites[row.feature] ||= []).push(row.id)
      for (const sites of Object.values(claim.featureSites)) Object.freeze(sites)
      Object.freeze(claim.featureSites)
    }
    for (const operations of Object.values(claim.allowed)) Object.freeze(operations)
    Object.freeze(claim.allowed)
    if (claim.permissions) Object.freeze(claim.permissions)
    Object.freeze(claim)
    if (cache.size >= 128) cache.delete(cache.keys().next().value!)
    cache.set(key, { claim, until: Date.now() + 60000 })
  }
  const after = await db
    .prepare('SELECT authority_revision FROM vc_organizations WHERE id=?')
    .bind(claim.organization)
    .first<{ authority_revision: number }>()
  if (after?.authority_revision !== claim.epoch)
    throw new APIError('Site permissions changed. Retry the request.', 403)
  return claim
}
export async function claimRequest(
  req: PayloadRequest,
  site?: string,
): Promise<AuthorityClaim | null> {
  if (!req.user || migrationRequest(req)) return null
  const claim = await identityAuthority(req, req.user, site)
  // Nested Local API calls must not silently replace a stale request's authority with a
  // newer epoch. A job/page must restart and review under its new permissions instead.
  const context = req.context as Record<symbol, unknown>
  req.context.authorityOperation ||= 'site-request'
  const epochs = (context[requestEpochs] ||= new Map<string, number>()) as Map<string, number>
  const key = `${claim.actor}:${claim.site}`
  const previous = epochs.get(key)
  if (previous !== undefined && previous !== claim.epoch)
    throw new APIError('Site permissions changed. Reload and retry.', 403)
  epochs.set(key, claim.epoch)
  // Local API callers may reuse one User object across concurrent site-bound requests.
  // Keep the authority on the request's copy so one tab/job cannot retarget another.
  req.user = withAuthority(req.user, claim)
  return claim
}
export async function confirmRequestAuthority(req: PayloadRequest): Promise<void> {
  if (migrationRequest(req)) return
  const claim = authorityClaim(req.user)
  if (!claim || claim.bootstrap) return
  const current = await cmsDatabase(req)
    .prepare(
      'SELECT authority_revision FROM vc_organizations WHERE id=? AND NOT EXISTS(SELECT 1 FROM vc_account_status WHERE user_id=? AND disabled=1)',
    )
    .bind(claim.organization, claim.actor)
    .first<{ authority_revision: number }>()
  if (current?.authority_revision !== claim.epoch)
    throw new APIError('Site permissions changed. Reload and retry.', 403)
}
