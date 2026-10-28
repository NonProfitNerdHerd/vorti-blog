'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export const secondaryModules = ['Tasks', 'Content', 'Intranet', 'CRM', 'Forms', 'Workflows', 'Site Design', 'Admin'] as const
export type SecondaryModule = (typeof secondaryModules)[number]

type SecondaryState = {
  preview: SecondaryModule | null
  pinned: (module: SecondaryModule) => boolean
  pin: (module: SecondaryModule) => void
  close: (module: SecondaryModule) => void
  showPreview: (module: SecondaryModule) => void
  hidePreview: (module: SecondaryModule) => void
}

const Context = createContext<SecondaryState | null>(null)

export function CRMSecondaryProvider({ children, identity }: { children: ReactNode; identity: string }) {
  const [closed, setClosed] = useState<Partial<Record<SecondaryModule, boolean>>>({})
  const [preview, setPreview] = useState<SecondaryModule | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const key = (module: SecondaryModule) => `vorti:secondary:${identity}:${module}`

  useEffect(() => {
    const saved: Partial<Record<SecondaryModule, boolean>> = {}
    try {
      for (const module of secondaryModules) {
        const value = window.localStorage.getItem(key(module))
        const legacy = module === 'CRM' ? window.localStorage.getItem(`vorti:crm-secondary:${identity}`) : null
        saved[module] = (value || legacy) === 'closed'
      }
    } catch { /* Keep the default-open state when storage is unavailable. */ }
    setClosed(saved)
    setPreview(null)
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [identity])

  const remember = (module: SecondaryModule, isClosed: boolean) => {
    setClosed(current => ({ ...current, [module]: isClosed }))
    setPreview(null)
    try { window.localStorage.setItem(key(module), isClosed ? 'closed' : 'open') } catch { /* Keep the in-memory choice. */ }
  }

  return <Context.Provider value={{
    preview,
    pinned: module => !closed[module],
    pin: module => remember(module, false),
    close: module => remember(module, true),
    showPreview: module => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setPreview(module)
    },
    hidePreview: module => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setPreview(current => current === module ? null : current), 160)
    },
  }}>{children}</Context.Provider>
}

export function useCRMSecondary() {
  const value = useContext(Context)
  if (!value) throw new Error('Admin navigation requires its secondary sidebar provider.')
  return value
}
