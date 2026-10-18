import type { ServerProps } from 'payload'
import type { ReactNode } from 'react'
import { SiteFormatProvider } from '@design-system/payload-design-core/content'
import { readCategoriesEnabled } from '@/lib/system-settings'
import { AdminPolicyClient } from './AdminPolicyClient'
import { WorkspaceDialogs } from '../review/WorkspaceDialogs'

export async function AdminPolicy({
  payload,
  user,
  children,
}: ServerProps & { children: ReactNode }) {
  const [categoriesEnabled, preference, site] = await Promise.all([
    readCategoriesEnabled(payload),
    user
      ? payload.find({
          collection: 'payload-preferences',
          depth: 0,
          limit: 1,
          user,
          overrideAccess: false,
          where: {
            and: [
              { key: { equals: 'vorti-dashboard-sidebar' } },
              { 'user.relationTo': { equals: user.collection } },
              { 'user.value': { equals: user.id } },
            ],
          },
        })
      : null,
    payload.findGlobal({ slug: 'site-settings', depth: 0, overrideAccess: false }),
  ])
  const value = preference?.docs[0]?.value as { open?: boolean } | undefined
  return (
    <SiteFormatProvider value={{ timezone: site.timezone, dateFormat: site.dateFormat, timeFormat: site.timeFormat }}><AdminPolicyClient
      key={user ? `${user.collection}:${user.id}` : 'anonymous'}
      initialCategoriesEnabled={categoriesEnabled}
      initialDashboardOpen={value?.open !== false}
    >
      {children}
      <WorkspaceDialogs/>
    </AdminPolicyClient></SiteFormatProvider>
  )
}
