'use client'
import { createContext } from 'react'

// undefined retains the standalone builder's inline transfer controls.
export const FormTransferHost = createContext<HTMLElement | null | undefined>(undefined)

export const FormEmailHost = createContext<{ target: HTMLElement | null; open: () => void } | undefined>(undefined)

export const FormWorkspaceNavigation = createContext<{ view: string; onChange: (view: string) => void } | undefined>(undefined)
