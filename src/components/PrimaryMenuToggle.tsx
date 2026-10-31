'use client'

import { useEffect, useRef } from 'react'
import { useNav } from '@payloadcms/ui'

export function PrimaryMenuToggle() {
  const { navOpen, setNavOpen } = useNav()
  const button = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const restoreWaffleFocus = useRef(false)
  useEffect(() => {
    if (navOpen && !wasOpen.current)
      requestAnimationFrame(() => document.querySelector<HTMLAnchorElement>('#vorti-primary-navigation a')?.focus())
    if (!navOpen && wasOpen.current)
      requestAnimationFrame(() => {
        if (restoreWaffleFocus.current) {
          restoreWaffleFocus.current = false
          button.current?.focus()
        } else document.querySelector<HTMLAnchorElement>('.vorti-secondary nav a')?.focus()
      })
    wasOpen.current = navOpen
  }, [navOpen])
  useEffect(() => {
    if (!navOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      restoreWaffleFocus.current = true
      setNavOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navOpen, setNavOpen])
  return <button ref={button} type="button" className="vorti-primary-waffle"
    aria-label={navOpen ? 'Close primary menu' : 'Open primary menu'}
    aria-expanded={navOpen} aria-controls="vorti-primary-navigation"
    onClick={() => setNavOpen(!navOpen)}>
    <span className="vorti-primary-waffle__dots" aria-hidden="true" />
  </button>
}
