import { SiteAnchor as Link } from '@design-system/payload-design-core/content'
import type { SiteSetting } from '@/payload-types'
import { privacyPath } from '@/lib/site-pages'
export function PrivacyPolicyLink({ site }: { site: SiteSetting }) {
  const href = privacyPath(site)
  return href ? (
    <Link className="site-privacy-link" href={href}>
      Privacy Policy
    </Link>
  ) : null
}
