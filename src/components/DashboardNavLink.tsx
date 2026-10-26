'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import { useState, type ComponentProps, type MouseEvent, type ReactNode } from 'react'
import type { DefaultNavClient } from '@payloadcms/next/client'
import {
  useAuth,
  useConfig,
  useNav,
  useTranslation,
  useWindowInfo,
  BrowseByFolderButton,
  Link as PayloadLink,
} from '@payloadcms/ui'
import { ChevronDown } from './ContentIcons'
import { InboxBadge } from '../review/WorkspaceInbox'
import { useAdminSite } from '../organizations/AdminSiteProvider'
import { hasUnsavedSiteChanges } from '../organizations/admin-site'
import { crmSections, crmURL, crmView } from '../crm/navigation'
import { enterNavigation, matchesAdminPath, type ExpansionState } from './navigation-state'
import './dashboard-nav.css'

export function DashboardNavLink({ admin }: { admin: string }) {
  const pathname = usePathname()
  return (
    <Link
      href={admin}
      className="vorti-dashboard-link"
      aria-current={pathname.replace(/\/$/, '') === admin.replace(/\/$/, '') ? 'page' : undefined}
    >
      Dashboard
    </Link>
  )
}

function NavigationGroup({
  label,
  open,
  toggle,
  href,
  children,
  navOpen,
  onNavigate,
  navigationLabel,
}: {
  label: string
  open: boolean
  toggle: () => void
  href?: string
  children: ReactNode
  navOpen: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  navigationLabel?: string
}) {
  const id = `vorti-nav-${encodeURIComponent(label)}`
  return (
    <div id={`nav-group-${label}`} className={`nav-group${open ? '' : ' nav-group--collapsed'}`}>
      <div className="task-nav-heading">
        {href && (
          <Link
            href={href}
            prefetch={false}
            className="vorti-nav-parent-link"
            onClick={onNavigate}
            tabIndex={navOpen ? undefined : -1}
            id={label === 'Tasks' ? 'nav-review-tasks' : undefined}
          >
            {label}
          </Link>
        )}
        <button
          type="button"
          className={href ? 'task-nav-toggle' : 'nav-group__toggle vorti-group-toggle'}
          aria-label={href ? `Toggle ${label} navigation` : label}
          aria-expanded={open}
          aria-controls={id}
          tabIndex={navOpen ? 0 : -1}
          onClick={toggle}
        >
          {!href && <span className="nav-group__label">{label}</span>}
          <ChevronDown size={16} style={{ transform: open ? undefined : 'rotate(-90deg)' }} />
        </button>
      </div>
      <nav
        id={id}
        hidden={!open}
        className="task-nav-children nav-group__content"
        aria-label={navigationLabel || `${label} navigation`}
      >
        {children}
      </nav>
    </div>
  )
}

export function PolicyNav({
  admin,
  groups,
}: Pick<ComponentProps<typeof DefaultNavClient>, 'groups'> &
  Partial<Pick<ComponentProps<typeof DefaultNavClient>, 'navPreferences'>> & { admin: string }) {
  const enabled = useCategoriesEnabled()
  const { navOpen, setNavOpen } = useNav()
  const { user } = useAuth()
  const { config } = useConfig()
  const { binding } = useAdminSite()
  const { breakpoints } = useWindowInfo()
  const pathname = usePathname()
  const params = useSearchParams()
  const { i18n } = useTranslation()
  const taskURL = `${admin}/collections/review-tasks`
  const tasks = groups.some((group) =>
    group.entities.some((entity) => entity.slug === 'review-tasks'),
  )
  const visible = groups
    .map((group) => ({
      ...group,
      entities: group.entities.filter(
        (entity) => entity.slug !== 'review-tasks' && (enabled || entity.slug !== 'categories'),
      ),
    }))
    .filter((group) => group.entities.length)
  const primary = visible.filter((group) => group.label !== 'Admin')
  const order = ['Content', 'Forms', 'Site Design']
  primary.sort(
    (a, b) =>
      (order.includes(a.label) ? order.indexOf(a.label) : order.length) -
      (order.includes(b.label) ? order.indexOf(b.label) : order.length),
  )
  const entityURL = (entity: (typeof visible)[number]['entities'][number]) =>
    `${admin}/${entity.type === 'globals' ? 'globals' : 'collections'}/${entity.slug}`
  const inCRM = matchesAdminPath(pathname, `${admin}/crm`)
  const inTasks = tasks && matchesAdminPath(pathname, taskURL)
  const active = inCRM
    ? 'CRM'
    : inTasks
      ? 'Tasks'
      : visible.find((group) =>
          group.entities.some((entity) => matchesAdminPath(pathname, entityURL(entity))),
        )?.label ||
        (matchesAdminPath(pathname, `${admin}/sites`) &&
        visible.some((group) => group.label === 'Admin')
          ? 'Admin'
          : undefined)
  const identity = user ? `${user.collection}:${user.id}` : 'anonymous'
  const route = `${pathname}?${params.toString()}|${active || ''}`
  const [stored, setStored] = useState<ExpansionState>(() =>
    enterNavigation(undefined, identity, route, active),
  )
  const expansion = enterNavigation(stored, identity, route, active)
  if (expansion !== stored) setStored(expansion)
  const toggle = (label: string) =>
    setStored((current) => ({
      ...current,
      open: { ...current.open, [label]: !current.open[label] },
    }))
  const site = params.get('site') || binding?.site.id
  const onNavigate = (event: MouseEvent<HTMLAnchorElement>, crm = false) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    if (
      crm &&
      hasUnsavedSiteChanges() &&
      !window.confirm('Discard unsaved changes before changing CRM sections?')
    ) {
      event.preventDefault()
      return
    }
    if (breakpoints.l !== false) setNavOpen(false)
  }
  const labelText = (label: (typeof visible)[number]['entities'][number]['label']) =>
    typeof label === 'string' ? label : label[i18n.language] || Object.values(label)[0]
  const renderNativeGroup = (group: (typeof visible)[number]) => (
    <NavigationGroup
      key={group.label}
      label={group.label}
      open={Boolean(expansion.open[group.label])}
      toggle={() => toggle(group.label)}
      navOpen={navOpen}
      onNavigate={onNavigate}
    >
      {group.entities.map((entity) => {
        const href = entityURL(entity),
          selected = matchesAdminPath(pathname, href)
        return (
          <PayloadLink
            key={entity.slug}
            id={`nav-${entity.type === 'globals' ? 'global-' : ''}${entity.slug}`}
            className="nav__link"
            href={href}
            prefetch={false}
            aria-current={selected ? 'page' : undefined}
            tabIndex={navOpen ? undefined : -1}
            onClick={onNavigate}
          >
            {selected && <div className="nav__link-indicator" />}
            <span className="nav__link-label">{labelText(entity.label)}</span>
          </PayloadLink>
        )
      })}
    </NavigationGroup>
  )
  const selectedCRM = inCRM ? crmView(params.get('view')) : undefined
  const selectedTask = inTasks
    ? params.get('workspace') || (params.get('taskView') === 'assigned' ? 'assigned' : 'all')
    : undefined
  const taskLinks = [
    ['assigned', 'My tasks', '?taskView=assigned'],
    ['all', 'All tasks', ''],
    ['projects', 'Projects', '?workspace=projects'],
    ['boards', 'Boards', '?workspace=boards'],
    ['inbox', 'Inbox', '?workspace=inbox'],
  ] as const
  return (
    <>
      <DashboardNavLink admin={admin} />
      {tasks && (
        <NavigationGroup
          label="Tasks"
          href={taskURL}
          open={Boolean(expansion.open.Tasks)}
          toggle={() => toggle('Tasks')}
          navOpen={navOpen}
          onNavigate={onNavigate}
        >
          {taskLinks.map(([id, label, query]) => (
            <Link
              key={id}
              className="nav__link"
              href={taskURL + query}
              aria-current={selectedTask === id ? 'page' : undefined}
              tabIndex={navOpen ? undefined : -1}
              onClick={onNavigate}
            >
              {label}
              {id === 'inbox' && (
                <>
                  {' '}
                  <InboxBadge api={config.routes.api} />
                </>
              )}
            </Link>
          ))}
        </NavigationGroup>
      )}
      {config.folders && config.folders.browseByFolder && (
        <BrowseByFolderButton
          active={matchesAdminPath(pathname, `${admin}${config.admin.routes.browseByFolder}`)}
        />
      )}
      {primary.filter((group) => group.label === 'Content').map(renderNativeGroup)}
      <NavigationGroup
        label="CRM"
        href={crmURL(admin, 'overview', site)}
        open={Boolean(expansion.open.CRM)}
        toggle={() => toggle('CRM')}
        navOpen={navOpen}
        onNavigate={(event) => onNavigate(event, true)}
        navigationLabel="CRM sections"
      >
        {crmSections.map(([id, label]) => (
          <Link
            key={id}
            className="nav__link"
            href={crmURL(admin, id, site)}
            prefetch={false}
            data-vc-crm-navigation="true"
            aria-current={selectedCRM === id ? 'page' : undefined}
            tabIndex={navOpen ? undefined : -1}
            onClick={(event) => onNavigate(event, true)}
          >
            {selectedCRM === id && <div className="nav__link-indicator" />}
            <span className="nav__link-label">{label}</span>
          </Link>
        ))}
      </NavigationGroup>
      {primary.filter((group) => group.label !== 'Content').map(renderNativeGroup)}
      {visible.filter((group) => group.label === 'Admin').map(renderNativeGroup)}
    </>
  )
}
