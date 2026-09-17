import Link from 'next/link'
import type { Metadata } from 'next'
import type { Navigation, Page } from '@/payload-types'
import { getPublicSiteData } from '@/lib/publicContent'
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

type MenuItem = NonNullable<Navigation['primary']>[number]

function menuLink(item: MenuItem) {
  if (item.enabled === false) return null
  if (item.linkType === 'internal') {
    const page = typeof item.page === 'object' ? item.page as Page : null
    if (!page || page._status !== 'published') return null
    return <Link href={`/${page.slug}`}>{item.label}</Link>
  }
  if (item.linkType === 'external' && item.url && /^https?:\/\//i.test(item.url)) {
    return <a href={item.url} target={item.newTab ? '_blank' : undefined} rel={item.newTab ? 'noopener noreferrer' : undefined}>{item.label}</a>
  }
  return null
}

function Menu({ items }: { items: Navigation['primary'] }) {
  if (!items?.length) return null
  return <ul>{items.map((item) => {
    const link = menuLink(item)
    if (!link) return null
    return <li key={item.id || item.label}>{link}{!!item.children?.length && <Menu items={item.children} />}</li>
  })}</ul>
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { navigation, siteSettings } = await getPublicSiteData()
  const siteName = siteSettings.siteName || 'Vorti Blog'

  return (
    <html lang="en">
      <body>
        <header className="site-header"><div className="site-header-inner">
          <Link className="site-title" href="/">{siteName}</Link>
          <nav className="site-nav" aria-label="Primary navigation"><Link href="/posts">Posts</Link><Menu items={navigation.primary} /></nav>
        </div></header>
        <main>{children}</main>
        <footer className="site-footer"><div className="site-footer-inner">
          <span>{siteSettings.copyrightText || `© ${new Date().getFullYear()} ${siteName}`}</span>
          <nav className="site-nav" aria-label="Footer navigation"><Menu items={navigation.footer} /></nav>
        </div></footer>
      </body>
    </html>
  )
}
