'use client'
import { createContext } from 'react'

// undefined retains the standalone builder's inline transfer controls.
export const FormTransferHost = createContext<HTMLElement | null | undefined>(undefined)
