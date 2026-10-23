'use client'
import { useEffect } from 'react'

/** Payload's native Tabs persist preferences but do not support a URL-selected tab. */
export function SubSitesNavigation(): null {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') !== 'SubSites') return
    const activate = () => {
      const tab = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button.tabs-field__tab-button'),
      ).find((button) => button.textContent?.trim() === 'SubSites')
      if (tab && !tab.classList.contains('tabs-field__tab-button--active')) tab.click()
    }
    // Payload restores saved tab preferences asynchronously after hydration.
    // Keep the URL-selected tab active through that restore, until the user
    // deliberately selects a different native settings tab.
    const observer = new MutationObserver(activate)
    const choose = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return
      const tab = event.target.closest('button.tabs-field__tab-button')
      if (tab && tab.textContent?.trim() !== 'SubSites') observer.disconnect()
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    document.addEventListener('click', choose, true)
    activate()
    return () => {
      observer.disconnect()
      document.removeEventListener('click', choose, true)
    }
  }, [])
  return null
}
