import type { ReactNode } from 'react'
import { PublicSiteProvider, SiteFormatProvider, CategoriesEnabledProvider } from '@design-system/payload-design-core/content'
import { internalContext } from '@/publishing/internal-context'
import { internalSiteShell } from '@/publishing/internal-shell'
import { SiteTemplateFooter, SiteTemplateHeader, SiteTemplateStyles } from '@/components/site-shell/SiteTemplateShell'
import '../(frontend)/styles.css'
import './portal.css'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }
export default async function IntranetLayout({ children }: { children: ReactNode }) {
  const selected = await internalContext(), shell = await internalSiteShell(selected)
  await selected.assertCurrent()
  return <html lang="en"><body className="intranet-site"><PublicSiteProvider prefix={selected.prefix} audience="intranet">
    {shell.kind === 'template' && <><SiteTemplateStyles template={shell.template} /><SiteTemplateHeader {...shell} /></>}
    {shell.kind === 'legacy' && <div className="intranet-search-bar container"><span>Internal · signed-in readers only</span><form action={selected.prefix + '/intranet'} role="search"><label htmlFor="portal-global-search">Search Intranet</label><input id="portal-global-search" type="search" name="q" maxLength={200} /><button>Search</button></form></div>}
    <SiteFormatProvider value={{ timezone: shell.siteSettings.timezone, dateFormat: shell.siteSettings.dateFormat, timeFormat: shell.siteSettings.timeFormat }}><CategoriesEnabledProvider value={selected.settings.categoriesEnabled !== false}><main>{children}</main></CategoriesEnabledProvider></SiteFormatProvider>
    {shell.kind === 'template' && <SiteTemplateFooter {...shell} />}
  </PublicSiteProvider></body></html>
}
