import { canInsertBlock } from './registry'
import type { TemplateNode, TemplateLayoutNode } from '../types'
import type { SiteShellNode, SiteShellLayoutNode } from '../site-shell'
import { templateStyle, type ContentNode } from '../content/model'
import { resolveDocumentHeadings } from './resolve'
export function adapterPreviewNodes(nodes: Array<TemplateNode | SiteShellNode>): ContentNode[] {
  const convert = (items: Array<TemplateNode | SiteShellNode>): ContentNode[] =>
    items.map((node) =>
      node.type === 'layout'
        ? {
            ...(node.block ?? { kind: 'group' }),
            id: node.id,
            children: convert([
              ...(node.children ?? []),
              ...(node.columns ?? []).flatMap<TemplateNode | SiteShellNode>(
                (column) => column.children ?? [],
              ),
            ]),
          }
        : node.type === 'field'
          ? {
              id: node.id,
              kind: node.fieldType === 'shortText' ? 'heading' : 'paragraph',
              text: node.content?.source === 'static' ? node.content.value : '',
            }
          : { id: node.id, kind: 'group' },
    )
  return resolveDocumentHeadings(convert(nodes))
}
export function adapterListings(
  nodes: Array<TemplateNode | SiteShellNode>,
): Array<{ id: string; label: string }> {
  return nodes.flatMap((node) => [
    ...(node.type === 'layout' && node.block?.kind === 'postListing'
      ? [{ id: node.id, label: node.block.label ?? 'Listing' }]
      : []),
    ...(node.type === 'layout' ? adapterListings(node.children ?? []) : []),
    ...(node.type === 'layout'
      ? (node.columns ?? []).flatMap((column) => adapterListings(column.children ?? []))
      : []),
  ])
}

/** The wrapper preserves existing tree/storage paths; block contains only this node's values. */
export function toTemplateBlock(node: ContentNode): TemplateLayoutNode {
  const { children, ...block } = node
  return {
    id: node.id,
    type: 'layout',
    layout: 'container',
    block,
    children: children?.map(toTemplateBlock),
  }
}
export function toShellBlock(node: ContentNode): SiteShellLayoutNode {
  const { children, ...block } = node
  return {
    id: node.id,
    type: 'layout',
    layout: 'container',
    block,
    children: children?.map(toShellBlock),
  }
}
export function mergeTemplateBlock(original: TemplateNode, node: ContentNode): TemplateNode {
  if (original.type !== 'layout' || !original.block) return original
  const { children, ...block } = node
  return {
    ...original,
    block,
    children: children?.map((child) => {
      const previous = original.children?.find((item) => item.id === child.id)
      return previous ? mergeTemplateBlock(previous, child) : toTemplateBlock(child)
    }),
  }
}
export function mergeShellBlock(original: SiteShellNode, node: ContentNode): SiteShellNode {
  if (original.type !== 'layout' || !original.block) return original
  const { children, ...block } = node
  return {
    ...original,
    block,
    children: children?.map((child) => {
      const previous = original.children?.find((item) => item.id === child.id)
      return previous ? mergeShellBlock(previous, child) : toShellBlock(child)
    }),
  }
}
export function templateBlockValue(node: TemplateNode): ContentNode | undefined {
  if (node.type !== 'layout' || !node.block) return undefined
  return {
    ...node.block,
    id: node.id,
    children: node.children?.map(
      (child) =>
        templateBlockValue(child) ??
        (child.type === 'field'
          ? {
              id: child.id,
              kind: child.fieldType === 'shortText' ? 'heading' : 'paragraph',
              text: child.content?.source === 'static' ? child.content.value : '',
              styles: templateStyle(child.style),
            }
          : { id: child.id, kind: 'group' }),
    ),
  }
}
export function shellBlockValue(node: SiteShellNode): ContentNode | undefined {
  if (node.type !== 'layout' || !node.block) return undefined
  return {
    ...node.block,
    id: node.id,
    children: node.children?.map(
      (child) =>
        shellBlockValue(child) ?? {
          id: child.id,
          kind: child.type === 'element' ? child.element : 'group',
          props: child.type === 'element' ? child.props : undefined,
        },
    ),
  }
}

export function canInsertAdapterNode(
  parent: TemplateNode | SiteShellNode | null | undefined,
  child: TemplateNode | SiteShellNode,
  root = false,
) {
  const value = (node: TemplateNode | SiteShellNode): ContentNode =>
    node.type === 'layout' && node.block
      ? { ...node.block, id: node.id }
      : { id: node.id, kind: node.type === 'layout' ? 'group' : 'paragraph' }
  return canInsertBlock(
    parent ? value(parent) : root ? undefined : { id: 'column', kind: 'group' },
    value(child),
  )
}
