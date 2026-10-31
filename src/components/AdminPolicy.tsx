import type { ServerProps } from 'payload'
import type { ReactNode } from 'react'
import { SiteFormatProvider } from '@design-system/payload-design-core/content'
import { readCategoriesEnabled } from '@/lib/system-settings'
import { AdminPolicyClient } from './AdminPolicyClient'
import { WorkspaceDialogs } from '../review/WorkspaceDialogs'
import { AdminSiteProvider } from '../organizations/AdminSiteProvider'

export async function AdminPolicy({
  payload,
  user,
  children,
}: ServerProps & { children: ReactNode }) {
  const [categoriesEnabled, site] = await Promise.all([
    readCategoriesEnabled(payload, user),
    payload.findGlobal({ slug: 'site-settings', depth: 0, overrideAccess: false, user }),
  ])
  return (
    <SiteFormatProvider value={{ timezone: site.timezone, dateFormat: site.dateFormat, timeFormat: site.timeFormat }}><AdminPolicyClient
      key={user ? `${user.collection}:${user.id}` : 'anonymous'}
      initialCategoriesEnabled={categoriesEnabled}
    >
      <AdminSiteProvider>{children}</AdminSiteProvider>
      <WorkspaceDialogs/>
    </AdminPolicyClient></SiteFormatProvider>
  )
}
