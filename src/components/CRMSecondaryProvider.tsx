'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type SecondaryState = {
  pinned: boolean
  preview: boolean
  pin: () => void
  close: () => void
  showPreview: () => void
  hidePreview: () => void
}

const Context = createContext<SecondaryState | null>(null)

export function CRMSecondaryProvider({ children, identity }: { children: ReactNode; identity: string }) {
  const [pinned, setPinned] = useState(true)
  const [preview, setPreview] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const key = `vorti:crm-secondary:${identity}`

  useEffect(() => {
    try { setPinned(window.localStorage.getItem(key) !== 'closed') } catch { setPinned(true) }
    setPreview(false)
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [key])

  const remember = (open: boolean) => {
    setPinned(open)
    setPreview(false)
    try { window.localStorage.setItem(key, open ? 'open' : 'closed') } catch { /* Keep the in-memory choice. */ }
  }

  return <Context.Provider value={{
    pinned,
    preview,
    pin: () => remember(true),
    close: () => remember(false),
    showPreview: () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setPreview(true)
    },
    hidePreview: () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setPreview(false), 160)
    },
  }}>{children}</Context.Provider>
}

export function useCRMSecondary() {
  const value = useContext(Context)
  if (!value) throw new Error('CRM navigation requires its sidebar provider.')
  return value
}
