'use client'
import { createContext, useContext } from 'react'
import type { SiteFormat } from './site-format'
export const SiteFormatContext = createContext<SiteFormat>({
  timezone: 'UTC',
  dateFormat: 'long',
  timeFormat: '12',
})
export const SiteFormatProvider = SiteFormatContext.Provider
export const useSiteFormat = () => useContext(SiteFormatContext)
