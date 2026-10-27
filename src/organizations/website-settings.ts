import type { PayloadRequest } from 'payload'
import { validateCMSRelations } from './cms-relations'
import { cmsDatabase, cmsSiteContext } from './cms-scope'
import { OrganizationRepository } from './repository'
import { atomicSiteMutation } from './atomic'
import { validateSiteSettings } from '../lib/site-settings-validation'

import { websiteSettingSections, websiteReferences, websiteBooleans } from './website-fields'
import { tenantAuthorityActive } from './tenant-runtime'
import { ScopedSettingsRepository } from './scoped-settings'

export async function saveWebsiteSettings(
  req: PayloadRequest,
  input: { site: string; settings: unknown; expectedRevision: number; operationKey: string },
) {
  if (await tenantAuthorityActive(cmsDatabase(req), input.site))
    return new ScopedSettingsRepository(cmsDatabase(req), Number(req.user?.id)).save({ ...input, scope: 'site' })
  if (input.site === 'default') throw new Error('Use the primary Site Settings editor.')
  const db = cmsDatabase(req),
    repo = new OrganizationRepository(db, Number(req.user!.id))
  const authority = await repo.require(input.site, 'content', 'configure')
  if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings))
    throw new Error('Enter valid website settings.')
  const settings = { ...input.settings } as Record<string, unknown>
  const allowed = new Set<string>(Object.values(websiteSettingSections).flat())
  for (const [key, value] of Object.entries(settings)) {
    if (!allowed.has(key)) throw new Error('Unsupported website setting.')
    if (websiteBooleans.has(key)) {
      if (value === null) settings[key] = false
      else if (typeof value !== 'boolean') throw new Error('Choose a valid option.')
    } else if (websiteReferences[key]) {
      if (value !== null && (!Number.isSafeInteger(value) || Number(value) <= 0))
        throw new Error('Choose an available site record.')
    } else if (value === null) settings[key] = ''
    else if (typeof value !== 'string' || value.length > 5000)
      throw new Error('Enter valid website text.')
  }
  if (
    typeof settings.siteName !== 'string' ||
    !settings.siteName.trim() ||
    settings.siteName.length > 160
  )
    throw new Error('Enter a site name.')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(settings.timezone || 'UTC') })
  } catch {
    throw new Error('Choose a valid IANA timezone.')
  }
  for (const key of websiteSettingSections['Social Links'])
    if (settings[key] && !/^https?:\/\//i.test(String(settings[key])))
      throw new Error('Enter a full http:// or https:// social URL.')
  if (
    settings.dateFormat &&
    !['long', 'short', 'iso', 'us', 'day-first'].includes(String(settings.dateFormat))
  )
    throw new Error('Choose a valid date format.')
  if (settings.timeFormat && !['12', '24'].includes(String(settings.timeFormat)))
    throw new Error('Choose a valid time format.')
  if (settings.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(settings.contactEmail)))
    throw new Error('Enter a valid public contact email.')
  const scoped = { ...req, context: cmsSiteContext(input.site) } as PayloadRequest
  const schema = req.payload.config.globals.find((global) => global.slug === 'site-settings')!
  await validateCMSRelations(scoped, schema.fields, settings)
  await validateSiteSettings({ req: scoped, data: settings, originalDoc: {} } as Parameters<
    typeof validateSiteSettings
  >[0])
  for (const name of ['primaryMenu', 'footerMenu']) {
    if (settings[name])
      await req.payload.findByID({
        collection: 'menus',
        id: Number(settings[name]),
        req: scoped,
        depth: 0,
        overrideAccess: false,
      })
  }
  const navigation: Record<string, unknown> = {}
  for (const name of ['primaryMenu', 'footerMenu']) {
    if (Object.hasOwn(settings, name)) {
      navigation[name] = settings[name]
      navigation[name === 'primaryMenu' ? 'primary' : 'footer'] = []
      delete settings[name]
    }
  }
  const value = JSON.stringify(settings),
    digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)))
  return atomicSiteMutation(db, {
    actor: Number(req.user!.id),
    operationKey: input.operationKey,
    fingerprint: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
      '',
    ),
    write: db
      .prepare(
        'UPDATE vc_site_websites SET presentation=?,navigation=json_patch(navigation,?),revision=revision+1 WHERE site_id=? AND initialized=1 AND revision=?',
      )
      .bind(value, JSON.stringify(navigation), input.site, input.expectedRevision),
    afterWrite: [
      db
        .prepare(
          'INSERT INTO vc_write_guards(operation_key,affected) SELECT ?,count(*) FROM vc_organizations WHERE id=? AND authority_revision=?',
        )
        .bind(
          input.operationKey + ':settings',
          authority.organization_id,
          authority.authorityRevision + 1,
        ),
      db
        .prepare('DELETE FROM vc_write_guards WHERE operation_key=?')
        .bind(input.operationKey + ':settings'),
      db
        .prepare(
          'INSERT INTO vc_platform_audit(id,organization_id,site_id,actor_id,action,record_type,record_id,after_value,operation_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          authority.organization_id,
          input.site,
          Number(req.user!.id),
          'website.settings',
          'website',
          input.site,
          JSON.stringify({ presentation: settings, navigation }),
          input.operationKey,
          new Date().toISOString(),
        ),
    ],
    result: { site: input.site, revision: input.expectedRevision + 1 },
  })
}
