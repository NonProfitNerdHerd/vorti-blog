'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuth, useConfig, useNav, useWindowInfo } from '@payloadcms/ui'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { crmSections, crmURL, crmView } from '../crm/navigation'
import { matchesAdminPath } from './navigation-state'
import { useCRMSecondary } from './CRMSecondaryProvider'
import './crm-secondary-nav.css'

export function CRMSecondaryNav() {
  const { config } = useConfig()
  const admin = config.routes.admin
  const pathname = usePathname()
  const params = useSearchParams()
  const { user } = useAuth()
  const { binding } = useAdminSite()
  const { setNavOpen } = useNav()
  const { breakpoints } = useWindowInfo()
  const { pinned, preview, close, hidePreview, showPreview } = useCRMSecondary()
  const allowed = !Array.isArray(user?.platformPermissions) || user.platformPermissions.includes('crm:read')
  const active = matchesAdminPath(pathname, `${admin}/crm`)
  const mobile = breakpoints.l !== false
  const visible = allowed && (mobile ? preview : ((active && pinned) || preview))
  if (!visible) return null
  const site = params.get('site') || binding?.site.id

  return <aside className="vc-crm-secondary" data-pinned={active && pinned && !mobile ? 'true' : 'false'}
    aria-label="CRM navigation" onMouseEnter={showPreview}
    onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) hidePreview() }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hidePreview() }}>
    <div className="vc-crm-secondary__head">
      <strong>CRM</strong>
      <button type="button" aria-label="Close CRM sidebar" onClick={mobile ? hidePreview : close}>Close</button>
    </div>
    <nav aria-label="CRM sections">
      {crmSections.map(([id, label]) => <Link key={id} href={crmURL(admin, id, site)} prefetch={false}
        data-vc-crm-navigation
        aria-current={active && crmView(params.get('view')) === id ? 'page' : undefined}
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          if (hasUnsavedSiteChanges() && !window.confirm('Discard unsaved changes before changing CRM sections?')) {
            event.preventDefault()
            return
          }
          hidePreview()
          if (breakpoints.l !== false) setNavOpen(false)
        }}>{label}</Link>)}
    </nav>
  </aside>
}

export function CRMSecondaryToggle() {
  const { showPreview } = useCRMSecondary()
  return <button type="button" className="vc-crm-secondary-toggle" onClick={showPreview}>CRM menu</button>
}
