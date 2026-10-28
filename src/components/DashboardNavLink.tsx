'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import { useAuth, useConfig, useNav, useTranslation, useWindowInfo, BrowseByFolderButton } from '@payloadcms/ui'
import type { DefaultNavClient } from '@payloadcms/next/client'
import type { ComponentProps, MouseEvent } from 'react'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { currentModule, moduleLinks, type NavGroup } from './admin-module-links'
import { matchesAdminPath } from './navigation-state'
import { useCRMSecondary, type SecondaryModule } from './CRMSecondaryProvider'
import './dashboard-nav.css'

export function DashboardNavLink({ admin }: { admin: string }) {
  const pathname = usePathname()
  return <Link href={admin} className="vorti-dashboard-link"
    aria-current={pathname.replace(/\/$/, '') === admin.replace(/\/$/, '') ? 'page' : undefined}>Dashboard</Link>
}

export function PolicyNav({ admin, groups }: Pick<ComponentProps<typeof DefaultNavClient>, 'groups'> & { admin: string }) {
  const enabled = useCategoriesEnabled()
  const { navOpen, setNavOpen } = useNav()
  const secondary = useCRMSecondary()
  const { user } = useAuth()
  const fine = Array.isArray(user?.platformPermissions) ? user.platformPermissions as string[] : null
  const { config } = useConfig()
  const { binding } = useAdminSite()
  const { breakpoints } = useWindowInfo()
  const { i18n } = useTranslation()
  const pathname = usePathname()
  const params = useSearchParams()
  const available = (groups as NavGroup[]).map(group => ({
    ...group, entities: group.entities.filter(entity => entity.slug !== 'review-tasks' && (enabled || entity.slug !== 'categories')),
  })).filter(group => group.entities.length)
  const active = currentModule(pathname, params, admin, available)
  const site = params.get('site') || binding?.site.id || 'default'
  const hasGroup = (label: SecondaryModule) => available.some(group => group.label === label)
  const allowed = (module: SecondaryModule) => module === 'Tasks'
    ? (groups as NavGroup[]).some(group => group.entities.some(entity => entity.slug === 'review-tasks'))
    : module === 'CRM' ? !fine || fine.includes('crm:read')
    : module === 'Intranet' ? fine?.some(permission => permission.startsWith('intranet:read')) === true
    : module === 'Workflows' ? !fine || fine.includes('workflows:read')
    : hasGroup(module)
  const normalClick = (event: MouseEvent<HTMLAnchorElement>) => !event.defaultPrevented && event.button === 0 &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  const onNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!normalClick(event)) return
    if (hasUnsavedSiteChanges() && !window.confirm('Discard unsaved changes before changing sections?')) {
      event.preventDefault()
      return
    }
    if (breakpoints.l !== false) setNavOpen(false)
  }
  const renderModule = (module: SecondaryModule) => {
    if (!allowed(module)) return null
    const first = moduleLinks(module, {
      admin, site, pathname, params, groups: available, language: i18n.language,
      categoriesEnabled: enabled, groupManagement: false,
    })[0]
    if (!first) return null
    return <div key={module} id={`nav-group-${module}`} className="nav-group"
      onMouseEnter={() => secondary.showPreview(module)}
      onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) secondary.hidePreview(module) }}
      onFocus={() => secondary.showPreview(module)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) secondary.hidePreview(module) }}>
      <div className="task-nav-heading"><Link className="vorti-nav-parent-link" href={first.href}
        id={module === 'Tasks' ? 'nav-review-tasks' : undefined}
        data-vc-crm-navigation prefetch={false} aria-current={active === module ? 'page' : undefined}
        tabIndex={navOpen ? undefined : -1}
        onClick={event => { onNavigate(event); if (normalClick(event)) secondary.pin(module) }}>{module}</Link></div>
    </div>
  }

  return <>
    <DashboardNavLink admin={admin} />
    {renderModule('Tasks')}
    {config.folders && config.folders.browseByFolder && <BrowseByFolderButton
      active={matchesAdminPath(pathname, `${admin}${config.admin.routes.browseByFolder}`)} />}
    {renderModule('Content')}
    {renderModule('Intranet')}
    {renderModule('CRM')}
    {fine?.some(permission => permission.startsWith('wiki:read')) &&
      <div id="nav-group-Wiki" className="nav-group"><div className="task-nav-heading">
        <a className="vorti-nav-parent-link" href={`/wiki?site=${encodeURIComponent(site)}&manage=1`}
          tabIndex={navOpen ? undefined : -1} onClick={onNavigate}>Wiki</a>
      </div></div>}
    {renderModule('Forms')}
    {renderModule('Workflows')}
    {renderModule('Site Design')}
    {renderModule('Admin')}
  </>
}
