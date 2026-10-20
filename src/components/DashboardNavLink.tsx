'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import { useState, type ComponentProps } from 'react'
import { ChevronDown } from './ContentIcons'
import { useNav, usePreferences } from '@payloadcms/ui'
import { PREFERENCE_KEYS } from 'payload/shared'
import { saveNavigationGroup } from './sidebar-preferences'
import { DefaultNavClient } from '@payloadcms/next/client'
import { NavGroup, useTranslation } from '@payloadcms/ui'
import './dashboard-nav.css'
import { InboxBadge } from '../review/WorkspaceInbox'
import { useConfig } from '@payloadcms/ui'

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

export function PolicyNav({
  admin,
  groups,
  ...props
}: ComponentProps<typeof DefaultNavClient> & { admin: string }) {
  const enabled = useCategoriesEnabled()
  const [tasksOpen, setTasksOpen] = useState(props.navPreferences?.groups?.Tasks?.open ?? true)
  const [savingNav, setSavingNav] = useState(false)
  const [navError, setNavError] = useState('')
  const { setPreference } = usePreferences()
  const { navOpen } = useNav()
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const pathname = usePathname()
  const { i18n } = useTranslation()
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
  const order = ['Content', 'Site Design', 'Forms']
  primary.sort(
    (a, b) =>
      (order.includes(a.label) ? order.indexOf(a.label) : order.length) -
      (order.includes(b.label) ? order.indexOf(b.label) : order.length),
  )
  const taskURL = `${admin}/collections/review-tasks`
  return (
    <>
      <DashboardNavLink admin={admin} />
      <DefaultNavClient {...props} groups={primary} />
      {tasks && (
        <div className="vorticause-task-nav nav-group">
          <div className="task-nav-heading">
            <Link
              className="vorti-nav-parent-link"
              id="nav-review-tasks"
              href={taskURL}
              aria-current={
                pathname === taskURL || pathname.startsWith(`${taskURL}/`) ? 'page' : undefined
              }
            >
              Tasks
            </Link>
            <button
              type="button"
              className="task-nav-toggle"
              aria-label="Toggle Tasks navigation"
              aria-expanded={tasksOpen}
              aria-controls="task-nav-children"
              disabled={savingNav}
              tabIndex={navOpen ? 0 : -1}
              onClick={async () => {
                const open = !tasksOpen
                setTasksOpen(open)
                setSavingNav(true)
                setNavError('')
                try {
                  const value = await saveNavigationGroup(api, 'Tasks', open)
                  // Synchronize the native context after the durable collection write.
                  void setPreference(PREFERENCE_KEYS.NAV, value, false).catch(() => {})
                } catch (error) {
                  setTasksOpen(!open)
                  setNavError(
                    error instanceof Error
                      ? error.message
                      : 'Could not save navigation preferences.',
                  )
                } finally {
                  setSavingNav(false)
                }
              }}
            >
              <ChevronDown
                size={16}
                style={{ transform: tasksOpen ? undefined : 'rotate(-90deg)' }}
              />
            </button>
          </div>
          {navError && <p role="alert">{navError}</p>}
          <nav
            id="task-nav-children"
            hidden={!tasksOpen}
            className="task-nav-children"
            aria-label="Tasks navigation"
          >
            <Link className="nav__link" href={`${taskURL}?taskView=assigned`}>
              My tasks
            </Link>
            <Link className="nav__link" href={taskURL}>
              All tasks
            </Link>
            <Link className="nav__link" href={`${taskURL}?workspace=projects`}>
              Projects
            </Link>
            <Link className="nav__link" href={`${taskURL}?workspace=boards`}>
              Boards
            </Link>
            <Link className="nav__link" href={`${taskURL}?workspace=inbox`}>
              Inbox <InboxBadge api={api} />
            </Link>
          </nav>
        </div>
      )}
      {visible
        .filter((group) => group.label === 'Admin')
        .map((group) => (
          <NavGroup
            key={group.label}
            label={group.label}
            isOpen={props.navPreferences?.groups?.[group.label]?.open}
          >
            {group.entities.map((entity) => {
              const href = `${admin}/${entity.type === 'globals' ? 'globals' : 'collections'}/${entity.slug}`
              const active = pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={entity.slug}
                  id={`nav-${entity.type === 'globals' ? 'global-' : ''}${entity.slug}`}
                  className="nav__link"
                  href={href}
                  aria-current={active ? 'page' : undefined}
                >
                  {active && <div className="nav__link-indicator" />}
                  <span className="nav__link-label">
                    {typeof entity.label === 'string'
                      ? entity.label
                      : entity.label[i18n.language] || Object.values(entity.label)[0]}
                  </span>
                </Link>
              )
            })}
          </NavGroup>
        ))}
    </>
  )
}
