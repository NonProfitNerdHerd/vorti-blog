'use client';
import { createContext, useContext } from 'react';
export const SiteFormatContext = createContext({
    timezone: 'UTC',
    dateFormat: 'long',
    timeFormat: '12',
});
export const SiteFormatProvider = SiteFormatContext.Provider;
export const useSiteFormat = () => useContext(SiteFormatContext);
