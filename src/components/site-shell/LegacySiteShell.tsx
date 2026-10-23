import { PrivacyPolicyLink } from './PrivacyPolicyLink'
import { postsPath } from '@/lib/site-pages'
import { publicPath } from '@/lib/public-site-context'
import { SiteAnchor as Link } from '@design-system/payload-design-core/content'
import type { Navigation, SiteSetting } from '@/payload-types'
import { Menu as SavedMenu } from '@design-system/payload-design-core/content'
import { legacyMenuLinks } from '@/menus/legacy'
function Menu({ items }: { items: Navigation['primary'] }) {
  return !items?.length ? null : (
    <SavedMenu menuID="1" initial={{ id: 1, name: 'Navigation', items: legacyMenuLinks(items) }} />
  )
}
export async function LegacyHeader({
  navigation,
  siteSettings,
}: {
  navigation: Navigation
  siteSettings: SiteSetting
}) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-title" href={await publicPath('/')}>
          {siteSettings.siteName || 'VortiCause'}
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link href={await publicPath(postsPath(siteSettings))}>Posts</Link>
          <Menu items={navigation.primary} />
        </nav>
      </div>
    </header>
  )
}
export function LegacyFooter({
  navigation,
  siteSettings,
}: {
  navigation: Navigation
  siteSettings: SiteSetting
}) {
  const name = siteSettings.siteName || 'VortiCause'
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>{siteSettings.copyrightText || `© ${new Date().getFullYear()} ${name}`}</span>
        <nav className="site-nav" aria-label="Footer navigation">
          <Menu items={navigation.footer} />
          <PrivacyPolicyLink site={siteSettings} />
        </nav>
      </div>
    </footer>
  )
}
