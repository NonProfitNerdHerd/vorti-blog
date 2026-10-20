'use client'
import { createContext, useContext, useId, useState } from 'react'
import type { Navigation } from '@/payload-types'
import { Menu } from '@design-system/payload-design-core/content'
import { legacyMenuLinks } from '@/menus/legacy'
const MenuContext = createContext<{ id: string; open: boolean; toggle: () => void }>({
  id: 'site-navigation',
  open: false,
  toggle: () => undefined,
})
export function MobileMenuProvider({ children }: { children: React.ReactNode }) {
  const reactID = useId()
  const [open, setOpen] = useState(false)
  return (
    <MenuContext.Provider
      value={{
        id: `site-navigation-${reactID.replace(/:/g, '')}`,
        open,
        toggle: () => setOpen((value) => !value),
      }}
    >
      {children}
    </MenuContext.Provider>
  )
}
export function MobileMenuToggle({ label = 'Menu' }: { label?: string }) {
  const menu = useContext(MenuContext)
  return (
    <button
      className="site-shell-menu-toggle"
      type="button"
      aria-controls={menu.id}
      aria-expanded={menu.open}
      onClick={menu.toggle}
    >
      {label}
    </button>
  )
}
export function SiteNavigation({ items, label }: { items: Navigation['primary']; label: string }) {
  const menu = useContext(MenuContext)
  if (!items?.length) return null
  return (
    <Menu
      navigationID={menu.id}
      className="site-shell-navigation"
      open={menu.open}
      menuID="1"
      initial={{ id: 1, name: label, items: legacyMenuLinks(items) }}
      label={label}
      mobile="expanded"
    />
  )
}
