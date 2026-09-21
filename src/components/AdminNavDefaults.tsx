'use client'

import { useEffect } from 'react'

export function AdminNavDefaults() {
  useEffect(() => {
    let timer = 0
    let attempts = 0
    let cancelled = false
    const applyDefaults = () => {
      if (cancelled) return
      const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-group__toggle'))
      if (!toggles.length) {
        timer = window.setTimeout(applyDefaults, 100)
        return
      }

      for (const toggle of toggles) {
        const label = toggle.textContent?.trim()
        const collapsed = toggle.classList.contains('nav-group__toggle--collapsed')
        if ((label === 'Content' && collapsed) || (label !== 'Content' && !collapsed)) {
          toggle.click()
        }
      }
      attempts += 1
      if (attempts < 10) timer = window.setTimeout(applyDefaults, 100)
    }

    timer = window.setTimeout(applyDefaults, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  return <span hidden data-admin-nav-defaults />
}
