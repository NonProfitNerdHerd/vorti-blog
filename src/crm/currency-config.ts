export type CurrencyConfig = { allowedCurrencies: string[]; defaultCurrency: string }

export const defaultCurrencyConfig: CurrencyConfig = { allowedCurrencies: ['USD'], defaultCurrency: 'USD' }

export function currencyExponent(code: string): number {
  if (!/^[A-Z]{3}$/.test(code) || !Intl.supportedValuesOf('currency').includes(code))
    throw new Error('Choose a supported currency.')
  const exponent = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits
  if (exponent > 4) throw new Error('Unsupported currency precision.')
  return exponent
}

export function validateCurrencyConfig(input: unknown): CurrencyConfig {
  if (!input || typeof input !== 'object') throw new Error('Choose allowed currencies.')
  const value = input as Partial<CurrencyConfig>
  if (!Array.isArray(value.allowedCurrencies) || value.allowedCurrencies.length < 1 || value.allowedCurrencies.length > 30 ||
    !value.allowedCurrencies.every(code => typeof code === 'string' && currencyExponent(code) >= 0) ||
    typeof value.defaultCurrency !== 'string' || !value.allowedCurrencies.includes(value.defaultCurrency))
    throw new Error('Choose a default from the allowed currencies.')
  return { allowedCurrencies: [...new Set(value.allowedCurrencies)].sort(), defaultCurrency: value.defaultCurrency }
}

export async function currencyConfigForSite(db: D1Database, site: string): Promise<CurrencyConfig> {
  const settingsTable = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vc_scoped_settings'").first()
  if (!settingsTable) return defaultCurrencyConfig
  const row = await db.prepare(`SELECT settings.value FROM vc_sites site LEFT JOIN vc_scoped_settings settings
    ON settings.tenant_id=site.organization_id AND settings.scope='tenant' WHERE site.id=? AND site.archived=0`)
    .bind(site).first<{ value: string | null }>()
  if (!row) throw new Error('Choose an active site.')
  if (!row.value) return defaultCurrencyConfig
  const value = JSON.parse(row.value) as Partial<CurrencyConfig>
  return validateCurrencyConfig({
    allowedCurrencies: value.allowedCurrencies ?? defaultCurrencyConfig.allowedCurrencies,
    defaultCurrency: value.defaultCurrency ?? defaultCurrencyConfig.defaultCurrency,
  })
}

export function assertConfiguredCurrency(config: CurrencyConfig, code: string, exponent: number) {
  if (!config.allowedCurrencies.includes(code) || currencyExponent(code) !== exponent)
    throw new Error('Choose an allowed currency with its standard precision.')
}

export async function assertHistoricalCurrencyPrecision(db: D1Database, site: string, code: string, exponent: number) {
  const tables = ['vc_crm_gifts', 'vc_crm_commitments', 'vc_crm_campaigns', 'vc_crm_appeals',
    'vc_crm_membership_types', 'vc_crm_opportunities']
  const present = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN(${tables.map(() => '?').join(',')})`)
    .bind(...tables).all<{ name: string }>()
  if (!present.results.length) return
  const rows = await db.prepare(present.results.map(row => `SELECT exponent FROM ${row.name} WHERE site_id=? AND currency=? AND exponent IS NOT NULL`).join(' UNION '))
    .bind(...present.results.flatMap(() => [site, code])).all<{ exponent: number }>()
  if (rows.results.some(row => row.exponent !== exponent))
    throw new Error('Existing records use a different precision for this currency in this site. Historical amounts are preserved; choose another currency or resolve the legacy records first.')
}
