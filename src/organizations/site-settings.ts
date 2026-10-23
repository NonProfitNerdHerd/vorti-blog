/** Private per-site identity settings. Public routes continue to use compatibility globals. */
export const siteSettingsSchema = [
  `CREATE TABLE IF NOT EXISTS vc_site_settings (
    site_id TEXT PRIMARY KEY NOT NULL REFERENCES vc_sites(id),
    value TEXT NOT NULL CHECK(json_valid(value)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), updated_at TEXT NOT NULL
  )`,
] as const

export const guardedGlobals = ['site_settings', 'navigation', 'system_settings'] as const
export const globalSettingsGuards = guardedGlobals.flatMap((table) =>
  ['insert', 'update'].flatMap((operation) => [
    `DROP TRIGGER IF EXISTS vc_${table}_${operation}_commit_guard`,
    `CREATE TRIGGER vc_${table}_${operation}_commit_guard BEFORE ${operation === 'insert' ? 'INSERT' : 'UPDATE OF platform_global_proof'} ON "${table}"
    WHEN NEW.platform_global_proof IS NOT NULL BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users u JOIN vc_organizations o ON o.id='default'
        WHERE u.id=json_extract(NEW.platform_global_proof,'$.actor')
        AND o.authority_revision=json_extract(NEW.platform_global_proof,'$.epoch')
        AND NOT EXISTS(SELECT 1 FROM vc_account_status a WHERE a.user_id=u.id AND a.disabled=1)
        ${table === 'system_settings' ? 'AND EXISTS(SELECT 1 FROM vc_installation_operators i WHERE i.user_id=u.id)' : ''})
      THEN RAISE(ABORT,'Global authority changed before commit') END;
    END`,
  ]),
)

export interface ScopedSiteSettings {
  siteName: string
  siteTagline: string
  timezone: string
}

export function validateScopedSiteSettings(input: unknown): ScopedSiteSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Enter valid site settings.')
  const values = input as Record<string, unknown>
  if (Object.keys(values).some((key) => !['siteName', 'siteTagline', 'timezone'].includes(key)))
    throw new Error('Unsupported site setting.')
  const text = (name: string, limit: number, required = false) => {
    const value = values[name]
    if (typeof value !== 'string' || value.length > limit || (required && !value.trim()))
      throw new Error(`Enter a valid ${name}.`)
    return value.trim()
  }
  const settings = {
    siteName: text('siteName', 160, true),
    siteTagline: text('siteTagline', 500),
    timezone: text('timezone', 100, true),
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone })
  } catch {
    throw new Error('Choose a valid IANA timezone.')
  }
  return settings
}
