'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import type { DefaultNavClient } from '@payloadcms/next/client'
import { useAuth, useConfig, useNav, useTranslation, useWindowInfo } from '@payloadcms/ui'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { InboxBadge } from '../review/WorkspaceInbox'
import { currentModule, moduleLinks, type NavGroup } from './admin-module-links'
import { useCRMSecondary, type SecondaryModule } from './CRMSecondaryProvider'
import './crm-secondary-nav.css'

type Props = Pick<ComponentProps<typeof DefaultNavClient>, 'groups'>

function useModuleState(groups: Props['groups'], checkCapability = true) {
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
  const canCheckGroups = checkCapability && fine?.includes('administration:assignments') === true
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
  const { breakpoints } = useWindowInfo()
  const { setNavOpen } = useNav()
  const secondary = useCRMSecondary()
  const closeButton = useRef<HTMLButtonElement>(null)
  const mobile = breakpoints.l !== false
  const module = secondary.preview || active
  useEffect(() => { if (mobile && secondary.preview) closeButton.current?.focus() }, [mobile, secondary.preview])
  if (!module || !allowed(module) || (mobile ? !secondary.preview : !(secondary.preview || secondary.pinned(module)))) return null
  const items = links(module)
  if (!items.length) return null
  const pinned = !mobile && !!active && secondary.pinned(active)
  const title = module === 'CRM' ? 'VortiCause' : module === 'Tasks' ? 'VortiTasks' : module
  const dismiss = () => {
    secondary.close(module)
    requestAnimationFrame(() => {
      if (mobile) document.querySelector<HTMLButtonElement>('.vorti-secondary-toggle')?.focus()
      else document.querySelector<HTMLAnchorElement>('.vorti-dashboard-link')?.focus()
    })
  }
  return <>{mobile && <button type="button" className="vorti-secondary-backdrop" tabIndex={-1}
    aria-label={`Dismiss ${module} menu`} onClick={dismiss} />}
    <aside className="vorti-secondary" data-pinned={pinned ? 'true' : 'false'}
    aria-label={`${module} navigation`} onMouseEnter={() => secondary.showPreview(module)}
    onKeyDown={event => { if (event.key === 'Escape') dismiss() }}
    onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) secondary.hidePreview(module) }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) secondary.hidePreview(module) }}>
    <div className="vorti-secondary__head"><strong>{title}</strong>
      <button ref={closeButton} type="button" aria-label={`Close ${module} sidebar`} onClick={dismiss}>Close</button>
    </div>
    <nav aria-label={`${module} sections`}>
      {items.map(item => <Link key={item.id} href={item.href} prefetch={false}
        data-vc-crm-navigation aria-current={module === active && item.active ? 'page' : undefined}
        onClick={event => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          if (hasUnsavedSiteChanges() && !window.confirm('Discard unsaved changes before changing sections?')) {
            event.preventDefault()
            return
          }
          secondary.hidePreview(module)
          if (mobile) setNavOpen(false)
        }}>{item.label}{module === 'Tasks' && item.id === 'inbox' && <InboxBadge api={api} showZero />}</Link>)}
    </nav>
  </aside></>
}

export function CRMSecondaryToggle({ groups }: Props) {
  const { active, allowed } = useModuleState(groups, false)
  const secondary = useCRMSecondary()
  if (!active || !allowed(active)) return null
  return <button type="button" className="vorti-secondary-toggle" aria-expanded={secondary.preview === active}
    onClick={() => secondary.showPreview(active)}>{active} menu</button>
}
