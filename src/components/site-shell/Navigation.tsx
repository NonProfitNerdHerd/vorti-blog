'use client'
import Link from 'next/link'
import { createContext, useContext, useId, useState } from 'react'
import type { Navigation, Page } from '@/payload-types'
type Item = NonNullable<Navigation['primary']>[number]
const MenuContext = createContext<{ id: string; open: boolean; toggle: () => void }>({ id: 'site-navigation', open: false, toggle: () => undefined })
export function MobileMenuProvider({ children }: { children: React.ReactNode }) { const reactID = useId(); const [open, setOpen] = useState(false); return <MenuContext.Provider value={{ id: `site-navigation-${reactID.replace(/:/g, '')}`, open, toggle: () => setOpen((value) => !value) }}>{children}</MenuContext.Provider> }
export function MobileMenuToggle({ label = 'Menu' }: { label?: string }) { const menu = useContext(MenuContext); return <button className="site-shell-menu-toggle" type="button" aria-controls={menu.id} aria-expanded={menu.open} onClick={menu.toggle}>{label}</button> }
function hrefFor(item: Item): string | null { if (item.enabled === false) return null; if (item.linkType === 'internal') { const page = typeof item.page === 'object' ? item.page as Page : null; return page?._status === 'published' && page.slug ? `/${page.slug}` : null } return item.linkType === 'external' && item.url && /^https?:\/\//i.test(item.url) ? item.url : null }
function Items({ items }: { items: Navigation['primary'] }) { return <ul>{items?.map((item) => { const href = hrefFor(item); if (!href) return null; const contents = item.linkType === 'internal' ? <Link href={href}>{item.label}</Link> : <a href={href} target={item.newTab ? '_blank' : undefined} rel={item.newTab ? 'noopener noreferrer' : undefined}>{item.label}</a>; return <li key={item.id || item.label}>{contents}{item.children?.length ? <Items items={item.children} /> : null}</li> })}</ul> }
export function SiteNavigation({ items, label }: { items: Navigation['primary']; label: string }) { const menu = useContext(MenuContext); if (!items?.length) return null; return <nav id={menu.id} className="site-shell-navigation" data-open={menu.open || undefined} aria-label={label}><Items items={items} /></nav> }
