'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCategoriesEnabled } from '@design-system/payload-design-core/admin'
import type { ComponentProps } from 'react'
import { DefaultNavClient } from '@payloadcms/next/client'
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

export function PolicyNav({
  admin,
  groups,
  ...props
}: ComponentProps<typeof DefaultNavClient> & { admin: string }) {
  const enabled = useCategoriesEnabled()
  const visible = groups
    .map((group) => ({
      ...group,
      entities: group.entities.filter((entity) => enabled || entity.slug !== 'categories'),
    }))
    .filter((group) => group.entities.length)
  return (
    <>
      <DashboardNavLink admin={admin} />
      <DefaultNavClient {...props} groups={visible} />
    </>
  )
}
