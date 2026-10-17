'use client'
import { createContext, useContext } from 'react'

export const CategoriesEnabledContext = createContext(true)
export const CategoriesEnabledProvider = CategoriesEnabledContext.Provider
export const useCategoriesEnabled = () => useContext(CategoriesEnabledContext)
