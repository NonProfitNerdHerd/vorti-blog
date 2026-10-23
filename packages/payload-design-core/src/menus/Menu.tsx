'use client'
import { usePublicFetch, SiteAnchor } from '../PublicSiteContext'
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { ResolvedMenu } from './model'
import './menu.css'
export function Menu({
  menuID,
  initial,
  editing,
  depth = 5,
  orientation = 'horizontal',
  alignment = 'start',
  gap = '1rem',
  submenuBackground = '#ffffff',
  submenuColor = '#1a1a1a',
  submenuPadding = '.5rem',
  submenuBorder = '1px solid #8884',
  submenuRadius = '8px',
  hoverColor = '#4f46e5',
  activeColor = '#4f46e5',
  label = 'Navigation',
  mobile = 'collapse',
  navigationID,
  className = '',
  open,
}: {
  menuID: string
  initial?: ResolvedMenu | null
  editing?: boolean
  depth?: number
  orientation?: string
  alignment?: string
  gap?: string
  submenuBackground?: string
  submenuColor?: string
  submenuPadding?: string
  submenuBorder?: string
  submenuRadius?: string
  hoverColor?: string
  activeColor?: string
  label?: string
  mobile?: string
  navigationID?: string
  className?: string
  open?: boolean
}) {
  const publicFetch = usePublicFetch()
  const id = `menu-${useId().replace(/:/g, '')}`,
    root = useRef<HTMLElement>(null)
  const [loaded, setLoaded] = useState(initial),
    [error, setError] = useState('')
  useEffect(() => {
    if (!menuID || (initial && String(initial.id) === menuID)) return
    const controller = new AbortController()
    publicFetch(`/api/menu-render/${encodeURIComponent(menuID)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Unavailable menu')
        setLoaded(await response.json())
        setError('')
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(menuID)
      })
    return () => controller.abort()
  }, [menuID, initial, publicFetch])
  const menu =
    initial && String(initial.id) === menuID
      ? initial
      : loaded && String(loaded.id) === menuID
        ? loaded
        : null
  useEffect(() => {
    const nav = root.current
    nav?.querySelectorAll<HTMLAnchorElement>('a').forEach((anchor) => {
      const target = new URL(anchor.href, location.href)
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        (!target.hash || target.hash === location.hash)
      )
        anchor.setAttribute('aria-current', 'page')
      else anchor.removeAttribute('aria-current')
    })
    const outside = (event: PointerEvent) => {
      if (!nav?.contains(event.target as Node))
        nav?.querySelectorAll('details[open]').forEach((item) => item.removeAttribute('open'))
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      const disclosure = (event.target as HTMLElement).closest('details')
      if (disclosure) {
        disclosure.removeAttribute('open')
        disclosure.querySelector('summary')?.focus()
        event.preventDefault()
      }
    }
    if (event.key === 'ArrowRight' && (event.target as HTMLElement).tagName === 'SUMMARY') {
      ;(event.target as HTMLElement).closest('details')?.setAttribute('open', '')
      event.preventDefault()
    }
    if (event.key === 'ArrowLeft') {
      const disclosure = (event.target as HTMLElement).closest('details')
      if (disclosure) {
        disclosure.removeAttribute('open')
        disclosure.querySelector('summary')?.focus()
        event.preventDefault()
      }
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const controls = Array.from(
        root.current?.querySelectorAll<HTMLElement>('a, summary') || [],
      ).filter((item) => item.getClientRects().length)
      const index = controls.indexOf(event.target as HTMLElement)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? controls.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
      controls[next]?.focus()
      event.preventDefault()
    }
  }
  if (!menuID) return editing ? <p>Select a menu in the inspector.</p> : null
  if (!menu)
    return editing ? (
      <p role="status">
        {error === menuID ? 'This menu is unavailable. Choose another menu.' : 'Loading menu…'}
      </p>
    ) : null
  const render = (items: ResolvedMenu['items'], level: number) => (
    <ul>
      {items.map((item) => (
        <li key={item.key}>
          <div className="vc-menu__item">
            <SiteAnchor
              href={item.href}
              target={item.newTab ? '_blank' : undefined}
              rel={item.newTab ? 'noopener noreferrer' : undefined}
              onClick={editing ? (event) => event.preventDefault() : undefined}
            >
              {item.label}
            </SiteAnchor>
            {item.children.length > 0 && level < depth && (
              <details
                onToggle={(event) => {
                  const disclosure = event.currentTarget,
                    list = disclosure.querySelector<HTMLElement>(':scope > ul')
                  if (!list || !disclosure.open) return
                  list.style.left = ''
                  list.style.right = ''
                  if (
                    orientation === 'horizontal' &&
                    window.innerWidth > 768 &&
                    list.getBoundingClientRect().right > window.innerWidth - 12
                  ) {
                    list.style.left = 'auto'
                    list.style.right = level > 1 ? '100%' : '0'
                  }
                }}
              >
                <summary aria-label={`Expand ${item.label} submenu`}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </summary>
                {render(item.children, level + 1)}
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
  return (
    <nav
      ref={root}
      id={navigationID}
      className={`vc-menu ${className}`}
      aria-label={label || menu.name}
      data-open={open || undefined}
      data-orientation={orientation}
      data-mobile={mobile}
      onKeyDown={keyboard}
      style={
        {
          '--menu-gap': gap,
          '--menu-align': alignment,
          '--menu-submenu': submenuBackground,
          '--menu-submenu-color': submenuColor,
          '--menu-submenu-padding': submenuPadding,
          '--menu-submenu-border': submenuBorder,
          '--menu-submenu-radius': submenuRadius,
          '--menu-hover': hoverColor,
          '--menu-active': activeColor,
        } as CSSProperties
      }
    >
      <details className="vc-menu__mobile">
        <summary aria-controls={id}>Menu</summary>
        <div id={id}>{render(menu.items, 1)}</div>
      </details>
      <div className="vc-menu__desktop">{render(menu.items, 1)}</div>
    </nav>
  )
}
