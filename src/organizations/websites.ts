import { OrganizationRepository, SiteAccessError } from './repository'
import { atomicSiteMutation, SiteConflictError } from './atomic'
import { disabledAncestorSQL } from './website-schema-v1'
import { tenantAuthorityActive } from './tenant-runtime'
import { ScopedSettingsRepository } from './scoped-settings'
import { TenantRepository } from './tenant-repository'

export interface WebsiteRecord {
  site_id: string
  subsites_enabled: number
  published: number
  initialized: number
  revision: number
  presentation: string
  navigation: string
  route_key?: string
}
export async function websiteStatus(db: D1Database, site: string) {
  const [record, controller, descendants] = await Promise.all([
    db
      .prepare(
        'SELECT w.*,s.route_key FROM vc_site_websites w JOIN vc_sites s ON s.id=w.site_id WHERE site_id=?',
      )
      .bind(site)
      .first<WebsiteRecord>(),
    db.prepare(disabledAncestorSQL(false)).bind(site).first<{ id: string; name: string }>(),
    db
      .prepare('SELECT count(*) AS count FROM vc_site_ancestry WHERE ancestor_id=? AND distance>0')
      .bind(site)
      .first<{ count: number }>(),
  ])
  if (!record) throw new Error('Website migrations are pending.')
  return { ...record, controller, descendants: descendants?.count ?? 0, settingsRevision: undefined as number|undefined }
}

export class WebsiteRepository {
  constructor(
    private db: D1Database,
    private actor: number,
  ) {}
  async status(site: string) {
    const repo = new OrganizationRepository(this.db, this.actor)
    const authority = await repo.require(site, 'content', 'read')
    const result = await websiteStatus(this.db, site)
    if(await tenantAuthorityActive(this.db,site)) {
      const scoped=await new ScopedSettingsRepository(this.db,this.actor).read(site)
      result.presentation=JSON.stringify(scoped.settings)
      result.navigation=JSON.stringify({primaryMenu:scoped.settings.primaryMenu||null,footerMenu:scoped.settings.footerMenu||null})
      result.settingsRevision=scoped.revision
    }
    if (
      (await repo.require(site, 'content', 'read')).authorityRevision !==
      authority.authorityRevision
    )
      throw new SiteConflictError()
    return result
  }
  async update(input: {
    site: string
    expectedRevision: number
    operationKey: string
    action: 'subsites' | 'publication'
    enabled: boolean
    confirmedDescendants?: number
  }) {
    const repo = new OrganizationRepository(this.db, this.actor)
    const authority = await repo.require(
      input.site,
      'content',
      input.action === 'publication' ? 'publish' : 'configure',
    )
    const before = await websiteStatus(this.db, input.site)
    if(await tenantAuthorityActive(this.db,input.site))await new TenantRepository(this.db,this.actor).require(input.site,input.action==='publication'?'administration:website-publication':'administration:subsites')
    if (typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.expectedRevision))
      throw new Error('Review valid website settings.')
    if (input.enabled && before.controller)
      throw new Error(`SubSites is disabled by ${before.controller.name}.`)
    if (
      input.action === 'subsites' &&
      !input.enabled &&
      input.confirmedDescendants !== before.descendants
    )
      throw new SiteConflictError()
    if (
      input.action === 'publication' &&
      (input.enabled && !before.initialized)
    )
      throw new Error('Initialize this website before publishing.')
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(input)),
    )
    const fingerprint = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    const field = input.action === 'subsites' ? 'subsites_enabled' : 'published'
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint,
      write: this.db
        .prepare(
          `UPDATE vc_site_websites SET ${field}=?,revision=revision+1 WHERE site_id=? AND revision=?`,
        )
        .bind(input.enabled ? 1 : 0, input.site, input.expectedRevision),
      afterWrite: [
        // The website update advances this epoch exactly once in the same D1 batch.
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations o WHERE o.id=? AND o.authority_revision=? AND NOT EXISTS(SELECT 1 FROM vc_account_status WHERE user_id=? AND disabled=1)',
          )
          .bind(
            input.operationKey + ':website',
            authority.organization_id,
            authority.authorityRevision + 1,
            this.actor,
          ),
        this.db
          .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
          .bind(input.operationKey + ':website'),
        this.db
          .prepare(
            'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            authority.organization_id,
            input.site,
            this.actor,
            'website.' + input.action,
            'website',
            input.site,
            JSON.stringify(before),
            JSON.stringify(input),
            input.operationKey,
            new Date().toISOString(),
          ),
      ],
      result: { site: input.site, revision: input.expectedRevision + 1 },
    })
  }
}

export async function requireSubsitesEnabled(db: D1Database, parent: string) {
  if (await db.prepare(disabledAncestorSQL(true)).bind(parent).first()) throw new SiteAccessError()
}

export async function requireWebsitePublishing(db: D1Database, site: string) {
  if (site !== 'default' && (await db.prepare(disabledAncestorSQL(false)).bind(site).first()))
    throw new Error(
      'An ancestor has disabled SubSites. Save a draft until publishing is enabled again.',
    )
}
