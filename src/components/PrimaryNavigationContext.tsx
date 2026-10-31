'use client'

import { createContext, useContext } from 'react'

export const PrimaryNavigationContext = createContext({
  startNavigation: (_href: string) => {},
})

export const usePrimaryNavigation = () => useContext(PrimaryNavigationContext)
