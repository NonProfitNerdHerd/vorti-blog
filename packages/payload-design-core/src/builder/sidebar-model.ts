import type { ContentNode } from '../content/model'
import type { TemplateNode } from '../types'
import type { SiteShellNode } from '../site-shell'

/** View-only projection: never persisted or used to replace the document schema. */
export type SidebarNode = {
  id: string
  ownerID?: string
  label: string
  kind: string
  children?: SidebarNode[]
  container?: boolean
  immovable?: boolean
  text?: string
  heading?: number
}
export type InsertionTarget = { parent: string; before?: string }
export const flattenSidebar = (nodes: SidebarNode[]): SidebarNode[] =>
  nodes.flatMap((node) => [node, ...flattenSidebar(node.children ?? [])])
export function locateSidebar(
  nodes: SidebarNode[],
  id: string,
  parent = 'root',
): { node: SidebarNode; parent: string; siblings: SidebarNode[]; index: number } | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.id === id) return { node, parent, siblings: nodes, index }
    const nested = locateSidebar(node.children ?? [], id, node.id)
    if (nested) return nested
  }
}
export function insertionTarget(nodes: SidebarNode[], selected?: string): InsertionTarget {
  const found = selected ? locateSidebar(nodes, selected) : undefined
  if (!found) return { parent: 'root' }
  if (found.node.ownerID) return insertionTarget(nodes, found.node.ownerID)
  if (found.node.kind === 'columns' && found.node.children?.length)
    return { parent: found.node.children[found.node.children.length - 1].id }
  if (found.node.container) return { parent: found.node.id }
  return { parent: found.parent, before: found.siblings[found.index + 1]?.id }
}
export function outlineSummary(nodes: SidebarNode[]) {
  const all = flattenSidebar(nodes)
  const text = all
    .map((node) => node.text ?? '')
    .join(' ')
    .trim()
  const words = text ? text.split(/\s+/u).length : 0
  return {
    headings: all.filter((node) => node.heading && node.text?.trim()),
    words,
    minutes: Math.ceil(words / 200),
  }
}
type LexicalNode = {
  type?: string
  text?: string
  tag?: string
  children?: LexicalNode[]
  root?: LexicalNode
}
function lexicalRows(value: unknown, ownerID: string): SidebarNode[] {
  if (!value || typeof value !== 'object') return []
  const root = (value as LexicalNode).root
  const text = (node: LexicalNode): string => node.text ?? (node.children ?? []).map(text).join('')
  const visit = (node: LexicalNode, path: string): SidebarNode[] => {
    if (['paragraph', 'heading', 'quote', 'listitem'].includes(node.type ?? '')) {
      const nested = (node.children ?? []).filter((child) => child.type === 'list')
      const ownText = (node.children ?? [])
        .filter((child) => child.type !== 'list')
        .map(text)
        .join('')
      return [
        {
          id: `${ownerID}:text:${path}`,
          ownerID,
          kind: node.type!,
          label: ownText || node.type!,
          text: ownText,
          heading: node.type === 'heading' ? Number(node.tag?.slice(1) || 2) : undefined,
          children: nested.flatMap((child, i) => visit(child, `${path}-${i}`)),
        },
      ]
    }
    return (node.children ?? []).flatMap((child, i) => visit(child, `${path}-${i}`))
  }
  return root ? visit(root, 'root') : []
}
const label = (kind: string) =>
  kind.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase())
export function contentSidebarNodes(nodes: ContentNode[]): SidebarNode[] {
  return nodes.map((node) => {
    if (node.kind === 'designed' && node.rendererKey === 'hero-board') {
      const values = node.values ?? {}
      const textFields = ['eyebrow', 'headline', 'subheadline'].flatMap((key) =>
        typeof values[key] === 'string' && values[key]
          ? [
              {
                id: `${node.id}:value:${key}`,
                ownerID: node.id,
                kind: key === 'headline' ? 'heading' : 'paragraph',
                label: String(values[key]),
                text: String(values[key]),
                heading: key === 'headline' ? 2 : undefined,
              },
            ]
          : [],
      )
      for (const key of ['primaryCTA', 'secondaryCTA']) {
        const text = (values[key] as { label?: unknown } | undefined)?.label
        if (typeof text === 'string')
          textFields.push({
            id: `${node.id}:value:${key}`,
            ownerID: node.id,
            kind: 'button',
            label: text,
            text,
            heading: undefined,
          })
      }
      return {
        id: node.id,
        kind: node.kind,
        label: node.label || 'Designed block',
        children: textFields,
      }
    }
    const rich = lexicalRows(node.richText, node.id)
    const list =
      node.kind === 'list' && !rich.length
        ? (node.text ?? '')
            .split('\n')
            .filter(Boolean)
            .map((text, i) => ({
              id: `${node.id}:item:${i}`,
              ownerID: node.id,
              label: text,
              text,
              kind: 'listitem',
            }))
        : []
    return {
      id: node.id,
      kind: node.kind,
      label: node.label || label(node.kind),
      container: ['group', 'row', 'column'].includes(node.kind),
      children: [...contentSidebarNodes(node.children ?? []), ...rich, ...list],
      text: rich.length || list.length ? undefined : node.text,
      heading: node.kind === 'heading' && !rich.length ? (node.level ?? 2) : undefined,
    }
  })
}
export function templateSidebarNodes(nodes: TemplateNode[]): SidebarNode[] {
  return nodes.map((node) => {
    if (node.type === 'layout')
      return {
        id: node.id,
        kind: node.layout,
        label: label(node.layout),
        container: ['container', 'row', 'stack'].includes(node.layout),
        children:
          node.layout === 'columns'
            ? node.columns?.map((column, i) => ({
                id: column.id,
                kind: 'column',
                label: `Column ${i + 1}`,
                container: true,
                immovable: true,
                children: templateSidebarNodes(column.children),
              }))
            : templateSidebarNodes(node.children ?? []),
      }
    if (node.type === 'block') return { id: node.id, kind: 'designed', label: node.name }
    const value = node.content?.source === 'static' ? node.content.value : undefined
    const rich = node.fieldType === 'richText' ? lexicalRows(value, node.id) : []
    return {
      id: node.id,
      kind: node.fieldType,
      label: node.label,
      text: typeof value === 'string' ? value : undefined,
      heading: node.fieldType === 'shortText' ? 2 : undefined,
      children: rich,
    }
  })
}
export function shellSidebarNodes(nodes: SiteShellNode[]): SidebarNode[] {
  return nodes.map((node) => {
    if (node.type === 'layout')
      return {
        id: node.id,
        kind: node.layout,
        label: label(node.layout),
        container: ['container', 'row', 'stack'].includes(node.layout),
        children:
          node.layout === 'columns'
            ? node.columns?.map((column, i) => ({
                id: column.id,
                kind: 'column',
                label: `Column ${i + 1}`,
                container: true,
                immovable: true,
                children: shellSidebarNodes(column.children),
              }))
            : shellSidebarNodes(node.children ?? []),
      }
    const rich = lexicalRows(node.props?.lexical, node.id)
    const text = ['text', 'button', 'copyright'].includes(node.element)
      ? (node.props?.text ?? node.props?.label)
      : undefined
    return {
      id: node.id,
      kind: node.element,
      label: label(node.element),
      text: typeof text === 'string' ? text : undefined,
      children: rich,
    }
  })
}
/** Copies structural IDs only; custom-field references remain shared by template design. */
export function duplicateBuilderNode<T>(node: T): T {
  const copy = structuredClone(node)
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string') record.id = `block_${crypto.randomUUID()}`
    if (record.style && typeof record.style === 'object')
      delete (record.style as Record<string, unknown>).anchor
    for (const key of ['children', 'columns'])
      if (Array.isArray(record[key])) record[key].forEach(visit)
  }
  visit(copy)
  return copy
}
