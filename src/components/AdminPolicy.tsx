import type { ServerProps } from 'payload'
import type { ReactNode } from 'react'
import { readCategoriesEnabled } from '@/lib/system-settings'
import { AdminPolicyClient } from './AdminPolicyClient'

export async function AdminPolicy({
  payload,
  user,
  children,
}: ServerProps & { children: ReactNode }) {
  const [categoriesEnabled, preference] = await Promise.all([
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
  ])
  const value = preference?.docs[0]?.value as { open?: boolean } | undefined
  return (
    <AdminPolicyClient
      key={user ? `${user.collection}:${user.id}` : 'anonymous'}
      initialCategoriesEnabled={categoriesEnabled}
      initialDashboardOpen={value?.open !== false}
    >
      {children}
    </AdminPolicyClient>
  )
}
