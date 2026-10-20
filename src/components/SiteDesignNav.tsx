import { NavHamburger, NavWrapper } from '@payloadcms/next/client'
import { PolicyNav } from './DashboardNavLink'
import { Logout } from '@payloadcms/ui'
import { EntityType, groupNavItems } from '@payloadcms/ui/shared'
import type { NavPreferences, PayloadRequest, ServerProps } from 'payload'
import { PREFERENCE_KEYS } from 'payload/shared'

const order = ['design-templates', 'site-templates', 'navigation', 'design-block-types']

/** Keep Payload's permission filtering, links, mobile toggle and persisted groups. */
export async function SiteDesignNav({
  payload,
  permissions,
  i18n,
  visibleEntities,
  req,
}: ServerProps & { req?: PayloadRequest }) {
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
  const stored = req?.user?.collection
    ? await payload.find({
        collection: 'payload-preferences',
        req,
        depth: 0,
        limit: 1,
        pagination: false,
        where: {
          and: [
            { key: { equals: PREFERENCE_KEYS.NAV } },
            { 'user.relationTo': { equals: req.user.collection } },
            { 'user.value': { equals: req.user.id } },
          ],
        },
      })
    : null
  const saved = stored?.docs[0]?.value as NavPreferences | undefined
  const navPreferences: NavPreferences = {
    ...saved,
    groups: {
      ...Object.fromEntries(groups.map((group) => [group.label, { open: group.label === 'Content' }])),
      ...saved?.groups,
    },
  }
  return (
    <NavWrapper baseClass="nav">
      <nav className="nav__wrap">
        <PolicyNav
          admin={payload.config.routes.admin}
          groups={groups}
          navPreferences={navPreferences}
        />
        <div className="nav__controls">
          <Logout />
        </div>
      </nav>
      <div className="nav__header">
        <div className="nav__header-content">
          <NavHamburger baseClass="nav" />
        </div>
      </div>
    </NavWrapper>
  )
}
