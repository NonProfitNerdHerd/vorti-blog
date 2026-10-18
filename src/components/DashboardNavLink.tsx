'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import type { ComponentProps } from 'react'
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
        <div>
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
          <nav className="task-nav-children" aria-label="Tasks navigation">
            <Link href={`${taskURL}?taskView=assigned`}>My tasks</Link>
            <Link href={taskURL}>All tasks</Link>
            <Link href={`${taskURL}?workspace=projects`}>Projects</Link>
            <Link href={`${taskURL}?workspace=boards`}>Boards</Link>
            <Link href={`${taskURL}?workspace=inbox`}>
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
