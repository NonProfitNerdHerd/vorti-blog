import type { Navigation, SiteSetting } from '../payload-types'
import { hydrateSiteShell, selectPublishedSiteTemplate } from '../lib/siteTemplate'
import { resolveMenu, legacyMenu } from '../menus/server'
import type { internalContext } from './internal-context'

export async function internalSiteShell(selected: Awaited<ReturnType<typeof internalContext>>) {
  const settings = { ...selected.settings, id: 0, siteName: selected.settings.siteName || selected.siteName,
    homepage: selected.settings.intranetHomepage, defaultSiteTemplate: selected.settings.intranetSiteTemplate,
    primaryMenu: selected.settings.intranetPrimaryMenu, footerMenu: selected.settings.intranetFooterMenu,
    showPrivacyPolicyLink: false } as SiteSetting
  const context = { site: selected.site, user: selected.user, audience: 'intranet' as const }
  const navigation = { id: 0, primary: [], footer: [] } as Navigation
  for (const slot of ['primary', 'footer'] as const) {
    const id = selected.settings[slot === 'primary' ? 'intranetPrimaryMenu' : 'intranetFooterMenu']
    if (!id) continue
    const menu = await resolveMenu(selected.payload, Number(id), selected.site, context)
    navigation[slot] = menu ? legacyMenu(menu.items) as Navigation[typeof slot] : []
  }
  const id = Number(selected.settings.intranetSiteTemplate)
  const template = id ? await selected.payload.findByID({ collection: 'site-templates', id, req: await selected.req(), depth: 0, overrideAccess: false }) : null
  if (template && (template.audience !== 'intranet' || template._status !== 'published')) throw Error('Assign a published Intranet Site Template.')
  return hydrateSiteShell(selected.payload, selectPublishedSiteTemplate(settings, navigation, template), context)
}
