import type { DocumentViewServerProps } from 'payload'
import { SettingsHubClient } from './SettingsHubClient'
import { TenantSettingsHub } from './TenantSettingsHub'
import { cmsDatabase } from '../organizations/cms-scope'
import { tenantAuthorityActive } from '../organizations/tenant-runtime'
import { ScopedSettingsRepository } from '../organizations/scoped-settings'
import { claimRequest } from '../organizations/identity-authority'
import { TenantPermissionError, TenantRepository } from '../organizations/tenant-repository'

export async function SettingsHub({ user, payload, initPageResult }: DocumentViewServerProps) {
  const req = initPageResult.req
  const params = new URL(req.url!).searchParams,
    selected = params.get('site') || 'default'
  if (user && (await tenantAuthorityActive(cmsDatabase(req), selected))) {
    const claim = await claimRequest(req, selected)
    const section = (params.get('section') || 'general').toLowerCase()
    const administration = section === 'roles' || section === 'features'
    if (administration)
      await new TenantRepository(cmsDatabase(req), Number(user.id)).require(
        selected,
        section === 'roles' ? 'administration:roles' : 'administration:features',
      )
    let value = administration
      ? { settings: {}, revision: 0 }
      : await new ScopedSettingsRepository(cmsDatabase(req), Number(user.id)).read(selected)
    if (section === 'features') {
      try {
        value = await new ScopedSettingsRepository(cmsDatabase(req), Number(user.id)).read(selected)
      } catch (error) {
        // Feature managers without Settings authority must still reach feature controls.
        if (!(error instanceof TenantPermissionError)) throw error
      }
    }
    return (
      <TenantSettingsHub
        key={selected + ':' + params.get('section')}
        site={selected}
        section={params.get('section') || 'general'}
        initial={value.settings}
        initialRevision={value.revision}
        tenantAdministrator={claim?.tenantAdministrator === true}
      />
    )
  }
  if (user?.role !== 'administrator') return <p>You do not have access to Settings.</p>
  const [site, system] = await Promise.all([
    payload.findGlobal({ slug: 'site-settings', depth: 1, user, overrideAccess: false }),
    payload.findGlobal({ slug: 'system-settings', depth: 0, user, overrideAccess: false }),
  ])
  return <SettingsHubClient initialSite={site} initialSystem={system} />
}
