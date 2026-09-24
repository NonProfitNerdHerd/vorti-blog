import type { Metadata } from 'next'
import { getPublicSiteData } from '@/lib/publicContent'
import { resolvePublicSiteShell } from '@/lib/siteTemplate'
import { LegacyFooter, LegacyHeader } from '@/components/site-shell/LegacySiteShell'
import { SiteTemplateFooter, SiteTemplateHeader, SiteTemplateStyles } from '@/components/site-shell/SiteTemplateShell'
import './styles.css'

export const dynamic = 'force-dynamic'
export async function generateMetadata(): Promise<Metadata> {
  const { siteSettings } = await getPublicSiteData()
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://vorti-blog.ike-j-rebout.workers.dev'),
    title: siteSettings.defaultSeoTitle || siteSettings.siteName || 'Vorti Blog',
    description: siteSettings.defaultSeoDescription || siteSettings.siteDescription || undefined,
  }
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const shell = await resolvePublicSiteShell()
  return <html lang="en"><body>
    {shell.kind === 'template' ? <><SiteTemplateStyles template={shell.template} /><SiteTemplateHeader {...shell} /></> : <LegacyHeader {...shell} />}
    <main>{children}</main>
    {shell.kind === 'template' ? <SiteTemplateFooter {...shell} /> : <LegacyFooter {...shell} />}
  </body></html>
}
