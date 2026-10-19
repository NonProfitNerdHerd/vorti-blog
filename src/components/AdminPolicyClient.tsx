'use client'
import { WorkspaceFeedback } from '@/review/WorkspaceFeedback'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NavContext, useNav, useConfig, toast, useWindowInfo, useAuth } from '@payloadcms/ui'
import { CategoriesEnabledProvider } from '@design-system/payload-design-core/admin'
import { saveDashboardSidebar } from './sidebar-preferences'

export function AdminPolicyClient({
  children,
  initialCategoriesEnabled,
  initialDashboardOpen,
}: {
  children: ReactNode
  initialCategoriesEnabled: boolean
  initialDashboardOpen: boolean
}) {
  const nav = useNav()
  const syncNav = nav.setNavOpen
  const nativeOpen = nav.navOpen
  const { config } = useConfig()
  const preferenceWrites = useRef(Promise.resolve())
  const { breakpoints } = useWindowInfo()
  const pathname = usePathname()
  const router = useRouter()
  const { user, refreshPermissions } = useAuth()
  const dashboard = pathname.replace(/\/$/, '') === config.routes.admin.replace(/\/$/, '')
  const mobile = breakpoints.l !== false
  const [dashboardOpen, setDashboardOpen] = useState(initialDashboardOpen)
  const [local, setLocal] = useState<{ path: string; open: boolean; mobile: boolean } | null>(null)
  if (local && (local.path !== pathname || local.mobile !== mobile)) setLocal(null)
  const [categoriesEnabled, setCategoriesEnabled] = useState(initialCategoriesEnabled)
  const denied =
    (!categoriesEnabled && pathname.startsWith(`${config.routes.admin}/collections/categories`)) ||
    (user?.role !== 'administrator' &&
      pathname.startsWith(`${config.routes.admin}/globals/system-settings`))
  const navOpen =
    local?.path === pathname && local.mobile === mobile
      ? local.open
      : dashboard && !mobile && dashboardOpen
  const setNavOpen = useCallback(
    (open: boolean) => {
      setLocal({ path: pathname, open, mobile })
      if (dashboard && !mobile) {
        setDashboardOpen(open)
        preferenceWrites.current = preferenceWrites.current
          .then(() => saveDashboardSidebar(config.routes.api, open))
          .catch(() => {
            toast.error('Could not remember the sidebar state. Please try again.')
          })
      }
    },
    [pathname, mobile, dashboard, config.routes.api],
  )
  // Keep Payload's scroll handling synchronized; route defaults never write preferences.
  useEffect(() => {
    syncNav(navOpen)
  }, [syncNav, navOpen, nativeOpen])
  useEffect(() => {
    if (denied) router.replace(config.routes.admin)
  }, [denied, router, config.routes.admin])
  useEffect(() => {
    const refresh = () => {
      void refreshPermissions().catch(() => {})
      void fetch(`${config.routes.api}/globals/system-settings?depth=0`, {
        credentials: 'same-origin',
      })
        .then(async (response) => {
          if (!response.ok) return
          const data = (await response.json()) as { categoriesEnabled?: boolean }
          setCategoriesEnabled(data.categoriesEnabled !== false)
        })
        .catch(() => {})
    }
    const saved = () => {
      refresh()
      router.refresh()
    }
    window.addEventListener('system-settings-saved', saved)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener('system-settings-saved', saved)
      window.removeEventListener('focus', refresh)
    }
  }, [config.routes.api, router, refreshPermissions])
  return (
    <NavContext.Provider value={{ ...nav, navOpen, setNavOpen }}>
      <CategoriesEnabledProvider value={categoriesEnabled}>
        <WorkspaceFeedback />
        {!categoriesEnabled && <style>{'.collections__card-list > li:has(> #card-categories) { display: none; }'}</style>}
        {denied ? (
          <main>
            <p>This screen is unavailable.</p>
          </main>
        ) : (
          children
        )}
      </CategoriesEnabledProvider>
    </NavContext.Provider>
  )
}
