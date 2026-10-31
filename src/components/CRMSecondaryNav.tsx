'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState, type ComponentProps } from 'react'
import type { DefaultNavClient } from '@payloadcms/next/client'
import { useAuth, useConfig, useNav, useTranslation } from '@payloadcms/ui'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { InboxBadge } from '../review/WorkspaceInbox'
import { currentModule, moduleLinks, type NavGroup } from './admin-module-links'
import type { SecondaryModule } from './secondary-modules'
import './crm-secondary-nav.css'

type Props = Pick<ComponentProps<typeof DefaultNavClient>, 'groups'>

const crmIcons: Record<string, string> = {
  overview: 'M3 10.5 12 3l9 7.5M5 9v12h14V9M9 21v-7h6v7',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm6 13v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  donations: 'M12 3v18m5-14H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6',
  households: 'M3 10 12 3l9 7v11H3V10Zm6 11v-7h6v7',
  fundraising: 'M3 11h18M5 11V5h14v6M6 11v10m12-10v10M9 6h6',
  giving: 'M12 21s-9-5.5-9-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.5-9 11-9 11Z',
  memberships: 'M4 4h16v16H4zM4 9h16M8 14h4m-4 3h7',
  opportunities: 'M12 3a7 7 0 0 0-4 12.75V19h8v-3.25A7 7 0 0 0 12 3Zm-4 18h8',
  volunteers: 'M12 21s-9-5.5-9-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.5-9 11-9 11ZM12 8v6m-3-3h6',
  correspondence: 'M3 5h18v14H3zM3 7l9 7 9-7',
  imports: 'M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4',
}

function useModuleState(groups: Props['groups']) {
  const { config } = useConfig()
  const pathname = usePathname()
  const params = useSearchParams()
  const { binding } = useAdminSite()
  const { user } = useAuth()
  const { i18n } = useTranslation()
  const enabled = useCategoriesEnabled()
  const fine = Array.isArray(user?.platformPermissions) ? user.platformPermissions as string[] : null
  const available = (groups as NavGroup[]).map(group => ({
    ...group, entities: group.entities.filter(entity => entity.slug !== 'review-tasks' && (enabled || entity.slug !== 'categories')),
  })).filter(group => group.entities.length)
  const active = currentModule(pathname, params, config.routes.admin, available)
  const site = params.get('site') || binding?.site.id || 'default'
  const [groupCapability, setGroupCapability] = useState<{ site: string; allowed: boolean } | null>(null)
  const canCheckGroups = fine?.includes('administration:assignments') === true
  useEffect(() => {
    if (!canCheckGroups) return
    const abort = new AbortController()
    void fetch(`${config.routes.api}/publishing/groups?site=${encodeURIComponent(site)}&capability=1`,
      { cache: 'no-store', signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw Error('Group capability unavailable.')
        const result = await response.json() as { canManage?: boolean }
        if (!abort.signal.aborted) setGroupCapability({ site, allowed: result.canManage === true })
      }).catch(() => { if (!abort.signal.aborted) setGroupCapability({ site, allowed: false }) })
    return () => abort.abort()
  }, [canCheckGroups, config.routes.api, site])
  const allowed = (module: SecondaryModule) => module === 'Tasks'
    ? (groups as NavGroup[]).some(group => group.entities.some(entity => entity.slug === 'review-tasks'))
    : module === 'CRM' ? !fine || fine.includes('crm:read')
    : module === 'Intranet' ? fine?.some(permission => permission.startsWith('intranet:read')) === true
    : module === 'Workflows' ? !fine || fine.includes('workflows:read')
    : available.some(group => group.label === module)
  const links = (module: SecondaryModule) => moduleLinks(module, {
    admin: config.routes.admin, site, pathname, params, groups: available,
    language: i18n.language, categoriesEnabled: enabled,
    groupManagement: canCheckGroups && groupCapability?.site === site && groupCapability.allowed,
  })
  return { active, allowed, links, api: config.routes.api }
}

export function CRMSecondaryNav({ groups }: Props) {
  const { active, allowed, links, api } = useModuleState(groups)
  const { navOpen } = useNav()
  if (navOpen || !active || !allowed(active)) return null
  const items = links(active)
  if (!items.length) return null
  const title = active === 'CRM' ? 'VortiCause' : active === 'Tasks' ? 'VortiTasks' : active
  return <aside className="vorti-secondary" data-module={active} aria-label={`${active} navigation`}>
    <div className="vorti-secondary__head"><strong>{title}</strong>
    </div>
    <nav aria-label={`${active} sections`}>
      {items.map(item => <Link key={item.id} href={item.href} prefetch={false}
        data-vc-crm-navigation aria-current={item.active ? 'page' : undefined}
        onClick={event => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          if (hasUnsavedSiteChanges() && !window.confirm('Discard unsaved changes before changing sections?')) {
            event.preventDefault()
            return
          }
        }}>{active === 'CRM' && <svg className="vorti-secondary__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={crmIcons[item.id] || crmIcons.overview} /></svg>}
          <span>{item.label}</span>{active === 'Tasks' && item.id === 'inbox' && <InboxBadge api={api} showZero />}</Link>)}
    </nav>
  </aside>
}
