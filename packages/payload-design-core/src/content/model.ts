import type { TemplateElementStyle } from '../types'
import {
  blockDefaults,
  canInsertBlock,
  getBlockDefinition,
  listBlockDefinitions,
} from '../blocks/registry'
import {
  publicDocumentFields,
  validatePresentation,
  type BlockPresentation,
} from '../blocks/presentation'
import { dimensionKeys, extendedStyleValue } from '../blocks/style-schema'

export type Viewport = 'desktop' | 'tablet' | 'mobile'
export type BlockStyle = {
  [key: string]: string | undefined
  backgroundColor?: string
  color?: string
  padding?: string
  margin?: string
  textAlign?: 'left' | 'center' | 'right'
  width?: string
  maxWidth?: string
  fontSize?: string
  lineHeight?: string
  borderWidth?: string
  borderColor?: string
  borderRadius?: string
  gap?: string
  minHeight?: string
  gridTemplateColumns?: string
}
export type ResponsiveBlockStyle = Partial<Record<Viewport, BlockStyle>>
export type ContentKind =
  | (string & {})
  | 'heading'
  | 'paragraph'
  | 'richText'
  | 'list'
  | 'quote'
  | 'image'
  | 'gallery'
  | 'button'
  | 'video'
  | 'group'
  | 'row'
  | 'columns'
  | 'column'
  | 'spacer'
  | 'divider'
  | 'designed'
  | 'value'
export type ContentNode = {
  id: string
  blockVersion?: number
  props?: Record<string, unknown>
  presentation?: BlockPresentation
  bindings?: Record<string, string>
  kind: ContentKind
  label?: string
  text?: string
  richText?: unknown
  level?: number
  ordered?: boolean
  url?: string
  media?: unknown
  alt?: string
  children?: ContentNode[]
  styles?: ResponsiveBlockStyle
  anchor?: string
  blockType?: string | number
  blockDesign?: string | number
  rendererKey?: string
  values?: Record<string, unknown>
  design?: Record<string, unknown>
  fields?: ContentNode[]
  /** Runtime bindings for a locked template; never persisted as freeform layout. */
  binding?: {
    path: string
    kind: string
    required?: boolean
    helpText?: string
    options?: string[]
    relationTo?: string
  }
}
export type ContentLayout = { version: 1; nodes: ContentNode[] }
export const contentLibrary: Array<{ kind: ContentKind; label: string; category: string }> = [
  ['heading', 'Heading', 'Text'],
  ['paragraph', 'Paragraph', 'Text'],
  ['richText', 'Rich text', 'Text'],
  ['list', 'List', 'Text'],
  ['quote', 'Quote', 'Text'],
  ['image', 'Image', 'Media'],
  ['gallery', 'Gallery', 'Media'],
  ['button', 'Button / link', 'Text'],
  ['video', 'Video', 'Media'],
  ['group', 'Group', 'Layout'],
  ['row', 'Row', 'Layout'],
  ['columns', 'Columns', 'Layout'],
  ['spacer', 'Spacer', 'Layout'],
  ['divider', 'Divider', 'Layout'],
].map(([kind, label, category]) => ({ kind: kind as ContentKind, label, category }))
for (const definition of listBlockDefinitions()) {
  if (definition.type !== 'column' && !contentLibrary.some((item) => item.kind === definition.type))
    contentLibrary.push({
      kind: definition.type,
      label: definition.label,
      category: definition.category,
    })
}
export const containerKinds = new (class extends Set<ContentKind> {
  override has(kind: ContentKind) {
    return !!getBlockDefinition(kind)?.container
  }
})(
  listBlockDefinitions()
    .filter((item) => item.container)
    .map((item) => item.type),
)
export const getContentLibrary = () => [
  ...contentLibrary,
  ...listBlockDefinitions()
    .filter(
      (item) =>
        item.type !== 'column' && !contentLibrary.some((existing) => existing.kind === item.type),
    )
    .map((item) => ({ kind: item.type, label: item.label, category: item.category })),
]
export function createContentNode(kind: ContentKind): ContentNode {
  const node: ContentNode = {
    id: `b_${crypto.randomUUID()}`,
    kind,
    label:
      getBlockDefinition(kind)?.label ??
      contentLibrary.find((item) => item.kind === kind)?.label ??
      kind,
    ...blockDefaults(kind),
  }
  if (containerKinds.has(kind))
    node.children =
      kind === 'columns'
        ? [createContentNode('column'), createContentNode('column')]
        : (node.children ?? [])
  if (kind === 'columns') node.styles = { tablet: { gridTemplateColumns: '1fr' } }
  if (kind === 'heading') node.level = 2
  if (kind === 'spacer') node.styles = { desktop: { minHeight: '32px' } }
  return node
}
export function walkContent(nodes: ContentNode[]): ContentNode[] {
  return nodes.flatMap((node) => [node, ...walkContent(node.children ?? [])])
}
export function updateContent(
  nodes: ContentNode[],
  id: string,
  update: (node: ContentNode) => ContentNode,
): ContentNode[] {
  return nodes.map((node) =>
    node.id === id
      ? update(node)
      : node.children
        ? { ...node, children: updateContent(node.children, id, update) }
        : node,
  )
}
export function removeContent(nodes: ContentNode[], id: string): ContentNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.children ? { ...node, children: removeContent(node.children, id) } : node))
}
export function insertContent(
  nodes: ContentNode[],
  node: ContentNode,
  parent = 'root',
  before?: string,
): ContentNode[] {
  const insert = (items: ContentNode[]) => {
    const copy = [...items]
    const at = before ? copy.findIndex((item) => item.id === before) : -1
    copy.splice(at < 0 ? copy.length : at, 0, node)
    return copy
  }
  if (parent === 'root') return canInsertBlock(undefined, node) ? insert(nodes) : nodes
  return updateContent(nodes, parent, (target) =>
    !canInsertBlock(target, node) ? target : { ...target, children: insert(target.children ?? []) },
  )
}
export function moveContent(
  nodes: ContentNode[],
  id: string,
  parent: string,
  before?: string,
): ContentNode[] {
  const node = walkContent(nodes).find((item) => item.id === id)
  const target =
    parent === 'root' ? undefined : walkContent(nodes).find((item) => item.id === parent)
  if (!node || before === id || walkContent([node]).some((item) => item.id === parent)) return nodes
  if (!canInsertBlock(target, node)) return nodes
  if (parent !== 'root' && (!target || !containerKinds.has(target.kind))) return nodes
  if ((target?.kind === 'columns') !== (node.kind === 'column')) return nodes
  return insertContent(removeContent(nodes, id), node, parent, before)
}
export function duplicateContent(node: ContentNode): ContentNode {
  return {
    ...structuredClone(node),
    id: `b_${crypto.randomUUID()}`,
    anchor: undefined,
    children: node.children?.map(duplicateContent),
  }
}
export function textDocument(node: ContentNode): unknown {
  const text = (value: string) => ({
    type: 'text',
    text: value,
    format: 0,
    detail: 0,
    mode: 'normal',
    style: '',
    version: 1,
  })
  const block = {
    type: node.kind === 'heading' ? 'heading' : node.kind === 'quote' ? 'quote' : 'paragraph',
    ...(node.kind === 'heading' ? { tag: `h${node.level ?? 2}` } : {}),
    children: [text(node.text ?? '')],
    direction: null as null,
    format: '',
    indent: 0,
    version: 1,
  }
  const children =
    node.kind === 'list'
      ? [
          {
            type: 'list',
            listType: node.ordered ? 'number' : 'bullet',
            tag: node.ordered ? 'ol' : 'ul',
            start: 1,
            direction: null as null,
            format: '',
            indent: 0,
            version: 1,
            children: (node.text ?? '').split('\n').map((line, index) => ({
              type: 'listitem',
              value: index + 1,
              children: [text(line)],
              direction: null as null,
              format: '',
              indent: 0,
              version: 1,
            })),
          },
        ]
      : [block]
  return {
    root: { type: 'root', children, direction: null as null, format: '', indent: 0, version: 1 },
  }
}
export function safeURL(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url) ? url : ''
}
const dimensions =
  /^(-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?|auto)(\s+(-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?|auto)){0,3}$/
const colors =
  /^(#[\da-f]{3,8}|transparent|currentColor|[a-z]+|rgba?\([\d\s.,%]+\)|var\(--[\w-]+\))$/i
export function validStyleValue(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false
  const extended = extendedStyleValue(key, value)
  if (extended !== undefined) return extended
  if (dimensionKeys.includes(key)) return dimensions.test(value)
  if (['backgroundColor', 'color', 'borderColor'].includes(key)) return colors.test(value)
  if (key === 'textAlign') return ['left', 'center', 'right'].includes(value)
  if (key === 'gridTemplateColumns') return /^\d+(\.\d+)?fr(\s+\d+(\.\d+)?fr){0,5}$/.test(value)
  return (
    [
      'padding',
      'margin',
      'width',
      'maxWidth',
      'fontSize',
      'lineHeight',
      'borderWidth',
      'borderRadius',
      'gap',
      'minHeight',
    ].includes(key) && dimensions.test(value)
  )
}
export function validateContentLayout(
  value: unknown,
  allowedBindingPaths: string[] = [],
): true | string {
  if (value == null) return true
  if (
    typeof value !== 'object' ||
    (value as ContentLayout).version !== 1 ||
    !Array.isArray((value as ContentLayout).nodes)
  )
    return 'Unsupported content layout.'
  const ids = new Set<string>()
  let count = 0
  function check(nodes: ContentNode[], depth: number, parent?: ContentNode): string | undefined {
    if (depth > 12) return 'Blocks may be nested at most 12 levels.'
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || ++count > 500)
        return 'Invalid block or too many blocks (maximum 500).'
      if (typeof node.id !== 'string' || !/^[\w-]+$/.test(node.id) || ids.has(node.id))
        return 'Block IDs must be unique.'
      ids.add(node.id)
      if (typeof node.kind !== 'string' || !node.kind) return 'Missing block type.'
      const presentationError = validatePresentation(node.presentation)
      if (presentationError) return presentationError
      const definition = getBlockDefinition(node.kind)
      if (
        node.blockVersion !== undefined &&
        (!Number.isInteger(node.blockVersion) || node.blockVersion < 1)
      )
        return 'Invalid block version.'
      const definitionError = definition?.validate?.(node)
      if (definitionError) return definitionError
      for (const [key, field] of Object.entries(node.bindings ?? {}))
        if (
          field &&
          (!definition?.fields.some((item) => item.key === key && item.bindable) ||
            (!(publicDocumentFields as readonly string[]).includes(field) &&
              !allowedBindingPaths.includes(field)))
        )
          return 'Unsupported dynamic field binding.'
      for (const state of ['hover', 'focus'] as const)
        for (const [key, val] of Object.entries(node.presentation?.[state] ?? {}))
          if (!validStyleValue(key, val)) return 'Invalid interaction style.'
      if (node.presentation?.link?.url && !safeURL(node.presentation.link.url))
        return 'Invalid block link URL.'
      if (node.props && (typeof node.props !== 'object' || Array.isArray(node.props)))
        return 'Invalid block properties.'
      for (const field of definition?.fields ?? []) {
        const val = node.props?.[field.key]
        if (val === undefined || val === '') continue
        if (field.type === 'number' && (typeof val !== 'number' || !Number.isFinite(val)))
          return `Invalid ${field.label}.`
        if (
          field.type === 'number' &&
          ((field.min !== undefined && Number(val) < field.min) ||
            (field.max !== undefined && Number(val) > field.max))
        )
          return `Invalid ${field.label} range.`
        if (!['number', 'toggle'].includes(field.type) && typeof val !== 'string')
          return `Invalid ${field.label}.`
        if (
          field.type === 'date' &&
          (!Number.isFinite(Date.parse(String(val))) || !/(Z|[+-]\d\d:\d\d)$/.test(String(val)))
        )
          return 'Dates must include a timezone.'
        if (field.type === 'toggle' && typeof val !== 'boolean') return `Invalid ${field.label}.`
        if (field.type === 'select' && !field.options?.includes(String(val)))
          return `Invalid ${field.label}.`
        if (field.type === 'url' && !safeURL(val)) return `Invalid ${field.label}.`
      }
      if ((parent?.kind === 'columns') !== (node.kind === 'column'))
        return 'Columns must contain column blocks, and column blocks must be inside Columns.'
      if (definition?.allowedParents && !definition.allowedParents.includes(parent?.kind ?? 'root'))
        return 'Block is not allowed in this container.'
      const parentDefinition = parent && getBlockDefinition(parent.kind)
      if (parentDefinition?.canContain && !parentDefinition.canContain(parent!, node))
        return 'Block is not allowed in this container.'
      if (node.binding) return 'Freeform blocks cannot declare template field bindings.'
      for (const key of ['text', 'label', 'alt', 'url', 'anchor'] as const)
        if (node[key] !== undefined && typeof node[key] !== 'string')
          return `Invalid ${key} on block ${node.id}.`
      if (
        node.richText != null &&
        (typeof node.richText !== 'object' || !('root' in node.richText))
      )
        return `Invalid rich text on block ${node.id}.`
      if (node.anchor && !/^[a-zA-Z][\w-]*$/.test(node.anchor))
        return 'Anchors must start with a letter and contain only letters, numbers, dashes or underscores.'
      if (node.url && !safeURL(node.url)) return 'Use a valid link URL.'
      if (node.level && ![1, 2, 3, 4, 5, 6].includes(node.level)) return 'Invalid heading level.'
      for (const [device, styles] of Object.entries(node.styles ?? {})) {
        if (
          !['desktop', 'tablet', 'mobile'].includes(device) ||
          !styles ||
          typeof styles !== 'object'
        )
          return 'Invalid responsive style.'
        for (const [key, val] of Object.entries(styles))
          if (!validStyleValue(key, val))
            return `Invalid ${key} style on ${node.label ?? node.kind}.`
      }
      if (node.children) {
        if (!Array.isArray(node.children) || (definition && !containerKinds.has(node.kind)))
          return 'Only layout blocks can contain children.'
        const error = check(node.children, depth + 1, node)
        if (error) return error
      }
    }
  }
  return check((value as ContentLayout).nodes, 0) ?? true
}
export function resolveStyle(
  style: ResponsiveBlockStyle | undefined,
  viewport: Viewport = 'desktop',
): BlockStyle {
  return {
    ...style?.desktop,
    ...(viewport !== 'desktop' ? style?.tablet : {}),
    ...(viewport === 'mobile' ? style?.mobile : {}),
  }
}
export function templateStyle(style?: TemplateElementStyle): ResponsiveBlockStyle {
  const spacing = { none: '0', small: '8px', medium: '16px', large: '32px' }
  const background = {
    transparent: 'transparent',
    surface: 'var(--theme-bg)',
    muted: '#f5f5f5',
    accent: 'var(--color-accent)',
  }
  return {
    desktop: {
      ...(style?.spacing ? { padding: spacing[style.spacing] } : {}),
      ...(style?.alignment ? { textAlign: style.alignment } : {}),
      ...(style?.background ? { backgroundColor: background[style.background] } : {}),
      ...(style?.fontSize
        ? {
            fontSize: { small: '14px', medium: '16px', large: '24px', xlarge: '36px' }[
              style.fontSize
            ],
          }
        : {}),
      ...(style?.textColor
        ? {
            color: {
              default: 'inherit',
              muted: '#666666',
              accent: 'var(--color-accent)',
              inverse: '#ffffff',
            }[style.textColor],
          }
        : {}),
      ...(style?.width
        ? {
            maxWidth: { content: '760px', wide: '1200px', full: '100%' }[style.width],
            width: '100%',
          }
        : {}),
      ...style?.responsive?.desktop,
    },
    tablet: style?.responsive?.tablet,
    mobile: style?.responsive?.mobile,
  }
}
