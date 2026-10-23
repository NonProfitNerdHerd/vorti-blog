import { publicSiteContext } from '@/lib/public-site-context'
import { PublicSiteProvider } from '@design-system/payload-design-core/content'
import type { Metadata } from 'next'
import { getPublicSiteDataSafe } from '@/lib/publicContent'
import { resolvePublicSiteShell } from '@/lib/siteTemplate'
import { LegacyFooter, LegacyHeader } from '@/components/site-shell/LegacySiteShell'
import { SiteTemplateFooter, SiteTemplateHeader, SiteTemplateStyles } from '@/components/site-shell/SiteTemplateShell'
import './styles.css'
import { mediaURL } from '@/lib/media'
import { SiteFormatProvider } from '@design-system/payload-design-core/content'
import { CategoriesEnabledProvider } from '@design-system/payload-design-core/content'
import { publicCategoriesEnabled } from '@/lib/public-categories'

export const dynamic = 'force-dynamic'
export async function generateMetadata(): Promise<Metadata> {
  const { siteSettings } = await getPublicSiteDataSafe()
  const {preview} = await publicSiteContext()
  return {
    icons: { icon: mediaURL(siteSettings.favicon) || '/vorticause-icon.svg' },
    robots: preview || siteSettings.discourageSearchIndexing ? { index: false, follow: false } : undefined,
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://vorti-blog.ike-j-rebout.workers.dev'),
    title: siteSettings.defaultSeoTitle || siteSettings.siteName || 'VortiCause',
    description: siteSettings.defaultSeoDescription || siteSettings.siteDescription || undefined,
  }
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const {prefix,preview} = await publicSiteContext()
  const shell = await resolvePublicSiteShell()
  const { siteSettings } = await getPublicSiteDataSafe()
  const categoriesEnabled = await publicCategoriesEnabled()
  return <html lang="en"><body><PublicSiteProvider prefix={prefix} preview={preview}>
    {shell.kind === 'template' ? <><SiteTemplateStyles template={shell.template} /><SiteTemplateHeader {...shell} /></> : <LegacyHeader {...shell} />}
    <SiteFormatProvider value={{ timezone: siteSettings.timezone, dateFormat: siteSettings.dateFormat, timeFormat: siteSettings.timeFormat }}><CategoriesEnabledProvider value={categoriesEnabled}><main>{children}</main></CategoriesEnabledProvider></SiteFormatProvider>
    {shell.kind === 'template' ? <SiteTemplateFooter {...shell} /> : <LegacyFooter {...shell} />}
  </PublicSiteProvider></body></html>
}
