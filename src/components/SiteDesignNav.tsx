import { NavHamburger, NavWrapper } from '@payloadcms/next/client'
import { PolicyNav } from './DashboardNavLink'
import { CRMSecondaryNav } from './CRMSecondaryNav'
import { Logout } from '@payloadcms/ui'
import { EntityType, groupNavItems } from '@payloadcms/ui/shared'
import type { ServerProps } from 'payload'

const order = ['design-templates', 'site-templates', 'navigation', 'design-block-types']

/** Keep Payload's permission filtering and mobile shell; groups are page-local. */
export async function SiteDesignNav({ payload, permissions, i18n, visibleEntities }: ServerProps) {
  const groups = groupNavItems(
    [
      ...payload.config.collections
        .filter(({ slug }) => visibleEntities.collections.includes(slug))
        .map((entity) => ({ entity, type: EntityType.collection as const })),
      ...payload.config.globals
        .filter(({ slug }) => visibleEntities.globals.includes(slug))
        .map((entity) => ({ entity, type: EntityType.global as const })),
    ],
    permissions,
    i18n,
  )
  for (const group of groups) {
    const groupOrder =
      group.label === 'Site Design'
        ? order
        : group.label === 'Forms'
          ? ['forms', 'form-submissions']
          : undefined
    if (groupOrder)
      group.entities.sort(
        (a, b) =>
          (groupOrder.indexOf(a.slug) < 0 ? groupOrder.length : groupOrder.indexOf(a.slug)) -
          (groupOrder.indexOf(b.slug) < 0 ? groupOrder.length : groupOrder.indexOf(b.slug)),
      )
  }
  return (
    <><NavWrapper baseClass="nav">
      <nav className="nav__wrap">
        <PolicyNav admin={payload.config.routes.admin} groups={groups} />
        <div className="nav__controls">
          <Logout />
        </div>
      </nav>
      <div className="nav__header">
        <div className="nav__header-content">
          <NavHamburger baseClass="nav" />
        </div>
      </div>
    </NavWrapper><CRMSecondaryNav /></>
  )
}
