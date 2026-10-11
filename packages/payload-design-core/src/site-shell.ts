import { canInsertAdapterNode } from './blocks/adapters'
import { getBlockDefinition } from './blocks/registry'
import { validateContentLayout, validStyleValue, type ResponsiveBlockStyle } from './content/model'
import { validatePresentation } from './blocks/presentation'
export const SITE_SHELL_LAYOUT_KINDS = ['container', 'row', 'columns', 'stack', 'spacer', 'divider'] as const

export const SITE_SHELL_ELEMENT_KINDS = [
  'logo',
  'siteName',
  'navigation',
  'button',
  'search',
  'text',
  'richText',
  'icon',
  'image',
  'socialLinks',
  'mobileMenuToggle',
  'copyright',
  'currentYear',
] as const

export type SiteShellLayoutKind = (typeof SITE_SHELL_LAYOUT_KINDS)[number]
export type SiteShellElementKind = (typeof SITE_SHELL_ELEMENT_KINDS)[number]

export type ResponsiveValue<T> = T | { desktop: T; tablet?: T; mobile?: T }

export type SiteShellStyleScalar = string | number | boolean | null
export type SiteShellStyle = Record<string, ResponsiveValue<SiteShellStyleScalar>>

export type SiteShellElementNode = {
  id: string
  type: 'element'
  element: SiteShellElementKind
  props?: Record<string, unknown>
  appearance?: import('./blocks/presentation').BlockPresentation
  responsiveStyles?: import('./content/model').ResponsiveBlockStyle
  style?: SiteShellStyle
}

export type SiteShellColumn = {
  id: string
  width: number
  children: SiteShellNode[]
}

export type SiteShellLayoutNode = {
  id: string
  type: 'layout'
  layout: SiteShellLayoutKind
  block?: import('./content/model').ContentNode
  children?: SiteShellNode[]
  columns?: SiteShellColumn[]
  appearance?: import('./blocks/presentation').BlockPresentation
  responsiveStyles?: import('./content/model').ResponsiveBlockStyle
  style?: SiteShellStyle
}

export type SiteShellNode = SiteShellLayoutNode | SiteShellElementNode

export type SiteShellRegionSettings = {
  widthMode?: 'contained' | 'full'
  maxWidth?: number
  minHeight?: number
  padding?: string
  margin?: string
  backgroundColor?: string
  backgroundImage?: string | number
  border?: string
  boxShadow?: string
  position?: 'static' | 'sticky' | 'fixed'
  transparent?: boolean
  zIndex?: number
}

export type SiteShellRegion = {
  layout: SiteShellNode[]
  settings?: SiteShellRegionSettings
}

export type SiteTemplateAssignment = {
  mode: 'default'
  priority: number
}

export const ADDITIONAL_CSS_MAX_LENGTH = 50_000

export function validateAdditionalCSS(value: unknown): true | string {
  if (value == null || value === '') return true
  if (typeof value !== 'string') return 'Additional CSS must be text.'
  if (value.length > ADDITIONAL_CSS_MAX_LENGTH) return `Additional CSS cannot exceed ${ADDITIONAL_CSS_MAX_LENGTH} characters.`
  if (/<\s*\/\s*style\b/i.test(value)) return 'Additional CSS cannot close a style element.'
  if (/@import\b/i.test(value)) return 'Additional CSS cannot use @import.'
  return true
}

export function validateSiteShellNodes(value: unknown): true | string {
  if (!Array.isArray(value)) return 'Site Shell layout must be an array.'
  const ids = new Set<string>()
  const error = validateNodes(value, ids)
  return error ?? true
}

function validateNodes(nodes: unknown[], ids: Set<string>): string | undefined {
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') return 'Every Site Shell node must be an object.'
    const node = raw as Record<string, unknown>
    if (typeof node.id !== 'string' || !node.id.trim()) return 'Every Site Shell node requires a stable id.'
    if (ids.has(node.id)) return `Site Shell node id "${node.id}" is duplicated.`
    ids.add(node.id)
    const appearanceError = validatePresentation(node.appearance as import('./blocks/presentation').BlockPresentation); if (appearanceError) return appearanceError
    const styleCheck = validateContentLayout({ version: 1, nodes: [{ id: 'validation', kind: 'group', styles: node.responsiveStyles, presentation: node.appearance }] }); if (styleCheck !== true) return styleCheck
    if (node.block && getBlockDefinition((node.block as {kind: string}).kind) && Array.isArray(node.children) && node.children.some(child => !canInsertAdapterNode(node as SiteShellNode, child))) return 'Invalid child block for this container.'
    if (node.block) { const valid = validateContentLayout({ version: 1, nodes: [{ ...(node.block as object), id: node.id, kind: (node.block as {kind: string}).kind === 'column' ? 'group' : (node.block as {kind: string}).kind }] }); if (valid !== true) return valid }

    if (node.type === 'element') {
      if (!SITE_SHELL_ELEMENT_KINDS.includes(node.element as SiteShellElementKind)) return `Unsupported Site Shell element "${String(node.element)}".`
      continue
    }

    if (node.type !== 'layout') return `Unsupported Site Shell node type "${String(node.type)}".`
    if (!SITE_SHELL_LAYOUT_KINDS.includes(node.layout as SiteShellLayoutKind)) return `Unsupported Site Shell layout "${String(node.layout)}".`

    if (node.block && Array.isArray(node.children) && node.children.length && getBlockDefinition((node.block as {kind: string}).kind) && !getBlockDefinition((node.block as {kind: string}).kind)?.container) return 'This registered block cannot contain children.'
    const children = node.children ?? []
    if (!Array.isArray(children)) return `Layout node "${node.id}" has invalid children.`
    const childError = validateNodes(children, ids)
    if (childError) return childError

    const columns = node.columns ?? []
    if (!Array.isArray(columns)) return `Layout node "${node.id}" has invalid columns.`
    if (node.layout === 'columns' && columns.length === 0) return `Columns node "${node.id}" requires at least one column.`
    if (node.layout !== 'columns' && columns.length > 0) return `Only columns nodes may contain columns.`
    let width = 0
    for (const rawColumn of columns) {
      if (!rawColumn || typeof rawColumn !== 'object') return `Columns node "${node.id}" contains an invalid column.`
      const column = rawColumn as Record<string, unknown>
      if (typeof column.id !== 'string' || !column.id.trim()) return `Every Site Shell column requires a stable id.`
      if (ids.has(column.id)) return `Site Shell node id "${column.id}" is duplicated.`
      ids.add(column.id)
      if (typeof column.width !== 'number' || column.width <= 0) return `Column "${column.id}" requires a positive width.`
      width += column.width
      if (!Array.isArray(column.children)) return `Column "${column.id}" has invalid children.`
      const columnError = validateNodes(column.children, ids)
      if (columnError) return columnError
    }
    if (columns.length > 0 && Math.abs(width - 100) > 0.01) return `Columns node "${node.id}" widths must total 100.`
  }
}

export const shellStyleKeys: Record<string, string> = { alignment: 'alignItems', justification: 'justifyContent', background: 'backgroundColor', textColor: 'color', shadow: 'boxShadow' }
export function shellInspectorStyles(node: SiteShellNode): ResponsiveBlockStyle {
  const result: ResponsiveBlockStyle = { desktop: {}, tablet: {}, mobile: {} }
  for (const [legacyKey, raw] of Object.entries(node.style ?? {})) {
    const key = shellStyleKeys[legacyKey] ?? legacyKey
    const values: Partial<Record<'desktop' | 'tablet' | 'mobile', SiteShellStyleScalar>> = raw && typeof raw === 'object' ? raw : { desktop: raw as SiteShellStyleScalar }
    for (const device of ['desktop', 'tablet', 'mobile'] as const) {
      const value = values[device]
      if (value !== undefined && validStyleValue(key, String(value))) result[device]![key] = String(value)
    }
  }
  for (const device of ['desktop', 'tablet', 'mobile'] as const) result[device] = { ...result[device], ...node.responsiveStyles?.[device] }
  return result
}
