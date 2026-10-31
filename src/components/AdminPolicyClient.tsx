'use client'
import { WorkspaceFeedback } from '@/review/WorkspaceFeedback'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { NavContext, useNav, useConfig, useAuth } from '@payloadcms/ui'
import { CategoriesEnabledProvider } from '@design-system/payload-design-core/admin'
import { NavigationExpansionProvider } from './NavigationExpansionProvider'
import { redirectToLogin, rememberReturnPath, restoreInactivityReturn } from './auth-return'
import { PrimaryNavigationContext } from './PrimaryNavigationContext'

function sameLocation(pathname: string, search: string, href: string) {
  const destination = new URL(href, 'https://admin.local')
  const current = new URL(`${pathname}${search ? `?${search}` : ''}`, 'https://admin.local')
  destination.searchParams.sort()
  current.searchParams.sort()
  return destination.pathname.replace(/\/$/, '') === current.pathname.replace(/\/$/, '') &&
    destination.search === current.search
}

export function AdminPolicyClient({
  children,
  initialCategoriesEnabled,
}: {
  children: ReactNode
  initialCategoriesEnabled: boolean
}) {
  const nav = useNav()
  const syncNav = nav.setNavOpen
  const nativeOpen = nav.navOpen
  const { config } = useConfig()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, refreshPermissions } = useAuth()
  const [primary, setPrimary] = useState<{ path: string; open: boolean } | null>(null)
  const [pendingPrimaryNavigation, setPendingPrimaryNavigation] = useState<string | null>(null)
  const [categoriesEnabled, setCategoriesEnabled] = useState(initialCategoriesEnabled)
  const denied =
    (user && !categoriesEnabled && pathname.startsWith(`${config.routes.admin}/collections/categories`)) ||
    (user && user.role !== 'administrator' &&
      pathname.startsWith(`${config.routes.admin}/globals/system-settings`))
  const destinationReached = pendingPrimaryNavigation !== null &&
    sameLocation(pathname, searchParams.toString(), pendingPrimaryNavigation)
  const navOpen = primary?.path === pathname && primary.open && !destinationReached
  const setNavOpen = useCallback(
    (open: boolean) => {
      setPendingPrimaryNavigation(null)
      setPrimary({ path: pathname, open })
    },
    [pathname],
  )
  const startNavigation = useCallback((href: string) => {
    setPendingPrimaryNavigation(href)
  }, [])
  useEffect(() => {
    if (!pendingPrimaryNavigation || !destinationReached && primary?.path === pathname) return
    setPrimary({ path: pathname, open: false })
    setPendingPrimaryNavigation(null)
  }, [pendingPrimaryNavigation, destinationReached, pathname, primary?.path])
  // Keep Payload's scroll handling synchronized with the one visible menu.
  useEffect(() => {
    syncNav(navOpen)
  }, [syncNav, navOpen, nativeOpen])
  useEffect(() => {
    if (denied) router.replace(config.routes.admin)
  }, [denied, router, config.routes.admin])
  useEffect(() => {
    if (!user && (pathname === config.routes.admin || pathname.startsWith(`${config.routes.admin}/`)) &&
      !/^\/(login|logout|logout-inactivity|forgot-password|reset-password|verify)(\/|$)/.test(pathname.slice(config.routes.admin.length)))
      redirectToLogin(config.routes.admin, config.admin.routes.login)
  }, [user, pathname, config.routes.admin, config.admin.routes.login])
  useEffect(() => {
    const admin = config.routes.admin
    const authRoute = /^\/(login|logout|logout-inactivity|forgot-password|reset-password|verify)(\/|$)/.test(pathname.slice(admin.length))
    if (authRoute) {
      if (pathname.endsWith('/login') || pathname.endsWith('/logout-inactivity')) restoreInactivityReturn(admin)
    } else if (user && (pathname === admin || pathname.startsWith(`${admin}/`))) {
      rememberReturnPath(admin, `${window.location.pathname}${window.location.search}${window.location.hash}`)
    }
  }, [user, pathname, searchParams, config.routes.admin])
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
    <PrimaryNavigationContext.Provider value={{ startNavigation }}>
    <NavContext.Provider value={{ ...nav, navOpen, setNavOpen }}>
      <NavigationExpansionProvider key={user ? `${user.collection}:${user.id}` : 'anonymous'}>
        <CategoriesEnabledProvider value={categoriesEnabled}>
          <WorkspaceFeedback />
          {!categoriesEnabled && (
            <style>
              {'.collections__card-list > li:has(> #card-categories) { display: none; }'}
            </style>
          )}
          {denied ? (
            <main>
              <p>This screen is unavailable.</p>
            </main>
          ) : (
            children
          )}
        </CategoriesEnabledProvider>
      </NavigationExpansionProvider>
    </NavContext.Provider>
    </PrimaryNavigationContext.Provider>
  )
}
