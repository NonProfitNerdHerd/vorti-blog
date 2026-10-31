import { atomicSiteMutation, SiteConflictError } from './atomic'
import { TenantRepository, TenantPermissionError } from './tenant-repository'
import { canDelegate } from './tenant-policy'
import { websiteSettingSections, websiteReferences, websiteBooleans } from './website-fields'
import { publicWebsite } from './public-website'
import { cmsCollections } from './cms-collections'

export const siteSettingDefaults = Object.freeze({
  siteName: 'VortiCause',
  siteTagline: '',
  timezone: 'UTC',
  dateFormat: 'long',
  timeFormat: '12',
  homepage: null,
  blogPage: null,
  privacyPolicyPage: null,
  showPrivacyPolicyLink: false,
  discourageSearchIndexing: false,
  categoriesEnabled: true,
  intranetHomepage: null,
  intranetSiteTemplate: null,
  intranetPrimaryMenu: null,
  intranetFooterMenu: null,
})
export const tenantSettingDefaults: { readonly workspaceEmbedOrigins: string[]; readonly fiscalYearStart: string } = Object.freeze({ workspaceEmbedOrigins: [] as string[], fiscalYearStart: '01-01' })
type Settings = Record<string, unknown>
const siteKeys = new Set<string>([
  ...Object.values(websiteSettingSections).flat(),
  'categoriesEnabled',
])

function object(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Enter valid settings.')
  return value as Settings
}
export function validateSiteSettingsPatch(input: unknown): Settings {
  const patch = { ...object(input) }
  for (const [key, value] of Object.entries(patch)) {
    if (!siteKeys.has(key)) throw Error(`Unsupported site setting: ${key}.`)
    if (websiteBooleans.has(key) || key === 'categoriesEnabled') {
      if (typeof value !== 'boolean') throw Error(`Choose a valid ${key} value.`)
    } else if (websiteReferences[key]) {
      if (value !== null && (!Number.isSafeInteger(value) || Number(value) < 1))
        throw Error('Choose an available site record.')
    } else if (typeof value !== 'string' || value.length > 5000)
      throw Error(`Enter valid ${key} text.`)
  }
  if (
    'siteName' in patch &&
    (typeof patch.siteName !== 'string' || !patch.siteName.trim() || patch.siteName.length > 160)
  )
    throw Error('Enter a site name.')
  if ('timezone' in patch) {
    if (typeof patch.timezone !== 'string' || !patch.timezone)
      throw Error('Choose a valid IANA timezone.')
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone })
    } catch {
      throw Error('Choose a valid IANA timezone.')
    }
  }
  if (
    'dateFormat' in patch &&
    !['long', 'short', 'iso', 'us', 'day-first'].includes(String(patch.dateFormat))
  )
    throw Error('Choose a valid date format.')
  if ('timeFormat' in patch && !['12', '24'].includes(String(patch.timeFormat)))
    throw Error('Choose a valid time format.')
  for (const key of websiteSettingSections['Social Links'])
    if (patch[key]) {
      let url: URL
      try {
        url = new URL(String(patch[key]))
      } catch {
        throw Error('Enter a complete social URL.')
      }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw Error('Enter a public HTTP or HTTPS URL without credentials.')
    }
  if (patch.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(patch.contactEmail)))
    throw Error('Enter a valid public contact email.')
  return patch
}
export function validateTenantSettings(input: unknown): typeof tenantSettingDefaults {
  const value = object(input)
  if (
    Object.keys(value).some((key) => !['workspaceEmbedOrigins', 'fiscalYearStart'].includes(key)) ||
    !Array.isArray(value.workspaceEmbedOrigins) ||
    value.workspaceEmbedOrigins.length > 30
  )
    throw Error('Use up to 30 exact HTTPS embed origins.')
  const origins = value.workspaceEmbedOrigins.map((origin) => {
    if (typeof origin !== 'string') throw Error('Enter an HTTPS origin.')
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw Error('Enter an HTTPS origin.')
    }
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
      throw Error('Use exact HTTPS origins without paths or credentials.')
    return origin
  })
  const fiscalYearStart = value.fiscalYearStart ?? '01-01'
  if (typeof fiscalYearStart !== 'string' || !/^\d{2}-\d{2}$/.test(fiscalYearStart) ||
    Number.isNaN(Date.parse(`2025-${fiscalYearStart}T00:00:00Z`)) ||
    new Date(`2025-${fiscalYearStart}T00:00:00Z`).toISOString().slice(5, 10) !== fiscalYearStart)
    throw Error('Choose a valid fiscal-year start month and day.')
  return { workspaceEmbedOrigins: [...new Set(origins)], fiscalYearStart }
}

/** The same loader is used by authenticated administration and public rendering. */
async function load(db: D1Database, tenant: string, scope: string, defaults: Settings) {
  const row = await db
    .prepare('SELECT value,revision FROM vc_scoped_settings WHERE tenant_id=? AND scope=?')
    .bind(tenant, scope)
    .first<{ value: string; revision: number }>()
  return {
    settings: { ...defaults, ...(row ? object(JSON.parse(row.value)) : {}) },
    revision: row?.revision ?? 0,
  }
}

/** Server adapter: callers authorize the site before resolving compatibility reads. */
export async function scopedSettingsForAuthorizedSite(db: D1Database, site: string, tenant: string) {
  if (!await db.prepare('SELECT id FROM vc_sites WHERE id=? AND organization_id=? AND archived=0').bind(site, tenant).first()) throw new TenantPermissionError()
  const [siteSettings, tenantSettings] = await Promise.all([
    load(db, tenant, `site:${site}`, siteSettingDefaults),
    load(db, tenant, 'tenant', tenantSettingDefaults),
  ])
  return { site: siteSettings, tenant: tenantSettings }
}

export async function publicScopedSiteSettings(db: D1Database, site: string) {
  const website = await publicWebsite(db, site)
  if (!website) return null
  const value = await load(db, website.organization_id, `site:${site}`, {
    ...siteSettingDefaults,
    siteName: website.name,
  })
  const after = await publicWebsite(db, site)
  if (!after || after.authority_revision !== website.authority_revision)
    throw new SiteConflictError()
  return { ...value, settings: Object.fromEntries(Object.entries(value.settings).filter(([key]) => !key.startsWith('intranet'))) }
}

export class ScopedSettingsRepository {
  private authority: TenantRepository
  constructor(
    private readonly db: D1Database,
    private readonly actor: number,
  ) {
    this.authority = new TenantRepository(db, actor)
  }
  async read(site: string, scope: 'site' | 'tenant' = 'site') {
    const authority = await this.authority.require(site, 'administration:settings')
    if (scope === 'tenant') {
      const snapshot = await this.authority.snapshot(site)
      if (
        !canDelegate(snapshot.policy, {
          site: null,
          descendants: false,
          permissions: ['administration:settings'],
        })
      )
        throw new TenantPermissionError()
    }
    const defaults = scope === 'tenant' ? tenantSettingDefaults : siteSettingDefaults
    const result = await load(
      this.db,
      authority.tenant,
      scope === 'tenant' ? 'tenant' : `site:${site}`,
      defaults,
    )
    await this.authority.assertRevision(authority.tenant, authority.revision)
    return { ...result, tenant: authority.tenant, authorityRevision: authority.revision, scope }
  }
  async save(input: {
    site: string
    scope: 'site' | 'tenant'
    settings: unknown
    expectedRevision: number
    operationKey: string
  }) {
    if (
      !['site', 'tenant'].includes(input.scope) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    )
      throw Error('Review a valid settings revision.')
    const current = await this.read(input.site, input.scope)
    if (current.revision !== input.expectedRevision) throw new SiteConflictError()
    const settings: Settings =
      input.scope === 'tenant'
        ? validateTenantSettings(input.settings)
        : { ...current.settings, ...validateSiteSettingsPatch(input.settings) }
    if (settings.showPrivacyPolicyLink && !settings.privacyPolicyPage)
      throw Error('Choose a privacy policy page before showing its link.')
    if (settings.homepage && settings.homepage === settings.blogPage)
      throw Error('Choose different homepage and posts pages.')
    const scope = input.scope === 'tenant' ? 'tenant' : `site:${input.site}`
    const referenceGuards: D1PreparedStatement[] = []
    // Validate changed relationships inside the same atomic batch as the setting write.
    // Retained references survive disabling Pages and never need to be discarded.
    if (input.scope === 'site')
      for (const [key, value] of Object.entries(object(input.settings))) {
        const collection = websiteReferences[key]
        if (!collection || value === null) continue
        const table = cmsCollections.find(([slug]) => slug === collection)?.[1]
        if (!table) throw Error('Unsupported settings relationship.')
        const guard = `${input.operationKey}:${key}`
        referenceGuards.push(
          this.db
            .prepare(
              `INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM "${table}" WHERE id=? AND platform_site=?${['pages', 'media', 'menus', 'site-templates'].includes(collection) ? ` AND audience='${key.startsWith('intranet') ? 'intranet' : 'public'}'` : ''}${collection === 'pages' ? " AND _status='published' AND slug NOT IN('admin','api','posts','forms','_next','wiki','intranet')" : collection === 'media' ? " AND mime_type LIKE 'image/%'" : ''}`,
            )
            .bind(guard, Number(value), input.site),
          this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(guard),
        )
      }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(input)),
    )
    const key = `${input.operationKey}:authority`
    return atomicSiteMutation(this.db, {
      actor: this.actor,
      operationKey: input.operationKey,
      fingerprint: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
      write:
        input.expectedRevision === 0
          ? this.db
              .prepare(
                'INSERT INTO vc_scoped_settings(tenant_id,scope,site_id,value) VALUES(?,?,?,?) ON CONFLICT(tenant_id,scope) DO NOTHING',
              )
              .bind(
                current.tenant,
                scope,
                input.scope === 'site' ? input.site : null,
                JSON.stringify(settings),
              )
          : this.db
              .prepare(
                'UPDATE vc_scoped_settings SET value=?,revision=revision+1 WHERE tenant_id=? AND scope=? AND revision=?',
              )
              .bind(JSON.stringify(settings), current.tenant, scope, input.expectedRevision),
      afterWrite: [
        this.db
          .prepare(
            'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,COUNT(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
          )
          .bind(key, current.tenant, current.authorityRevision + 1),
        this.db.prepare('DELETE FROM vc_write_guards WHERE operation_key=?').bind(key),
        ...referenceGuards,
        this.db
          .prepare(
            `INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,before_value,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            current.tenant,
            input.scope === 'site' ? input.site : null,
            this.actor,
            'settings.saved',
            'settings',
            scope,
            JSON.stringify(current.settings),
            JSON.stringify(settings),
            input.operationKey,
            new Date().toISOString(),
          ),
      ],
      result: { settings, revision: input.expectedRevision + 1, scope: input.scope },
    })
  }
}
