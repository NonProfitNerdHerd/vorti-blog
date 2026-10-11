import { canInsertAdapterNode } from './blocks/adapters'
import { getBlockDefinition } from './blocks/registry'
import type { SiteShellNode } from './site-shell'

export function findSiteShellNode(nodes: SiteShellNode[], id: string): SiteShellNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.type === 'layout') {
      const child = findSiteShellNode(node.children ?? [], id)
      if (child) return child
      for (const column of node.columns ?? []) {
        const nested = findSiteShellNode(column.children, id)
        if (nested) return nested
      }
    }
  }
  return null
}

export function updateSiteShellNode(
  nodes: SiteShellNode[],
  id: string,
  next: SiteShellNode,
): SiteShellNode[] {
  return nodes.map((node) =>
    node.id === id
      ? next
      : node.type === 'layout'
        ? {
            ...node,
            children: node.children ? updateSiteShellNode(node.children, id, next) : undefined,
            columns: node.columns?.map((column) => ({
              ...column,
              children: updateSiteShellNode(column.children, id, next),
            })),
          }
        : node,
  )
}

export function removeSiteShellNode(nodes: SiteShellNode[], id: string): SiteShellNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.type === 'layout'
        ? {
            ...node,
            children: node.children ? removeSiteShellNode(node.children, id) : undefined,
            columns: node.columns?.map((column) => ({
              ...column,
              children: removeSiteShellNode(column.children, id),
            })),
          }
        : node,
    )
}

export function insertSiteShellNode(
  nodes: SiteShellNode[],
  parentID: string,
  inserted: SiteShellNode,
  beforeID?: string,
): SiteShellNode[] {
  const insert = (items: SiteShellNode[]) => {
    const next = [...items]
    const at = beforeID ? next.findIndex((item) => item.id === beforeID) : -1
    next.splice(at < 0 ? next.length : at, 0, inserted)
    return next
  }
  if (parentID === 'root') return canInsertAdapterNode(undefined, inserted, true) ? insert(nodes) : nodes
  return nodes.map((node) => {
    if (node.type !== 'layout') return node
    if (node.id === parentID && canInsertAdapterNode(node, inserted) && !['columns', 'spacer', 'divider'].includes(node.layout) && (!node.block || getBlockDefinition(node.block.kind)?.container))
      return { ...node, children: insert(node.children ?? []) }
    return {
      ...node,
      children: insertSiteShellNode(node.children ?? [], parentID, inserted, beforeID),
      columns: node.columns?.map((column) =>
        column.id === parentID && canInsertAdapterNode(undefined, inserted)
          ? { ...column, children: insert(column.children) }
          : { ...column, children: insertSiteShellNode(column.children, parentID, inserted, beforeID) },
      ),
    }
  })
}

export function moveSiteShellNode(
  nodes: SiteShellNode[],
  id: string,
  direction: -1 | 1,
): SiteShellNode[] {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) {
    const target = index + direction
    if (target < 0 || target >= nodes.length) return nodes
    const copy = [...nodes]
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
    return copy
  }
  return nodes.map((node) =>
    node.type === 'layout'
      ? {
          ...node,
          children: moveSiteShellNode(node.children ?? [], id, direction),
          columns: node.columns?.map((column) => ({
            ...column,
            children: moveSiteShellNode(column.children, id, direction),
          })),
        }
      : node,
  )
}

function extract(
  nodes: SiteShellNode[],
  id: string,
): { nodes: SiteShellNode[]; node: SiteShellNode | null } {
  let found: SiteShellNode | null = null
  const next = nodes.flatMap((node): SiteShellNode[] => {
    if (node.id === id) {
      found = node
      return []
    }
    if (node.type !== 'layout') return [node]
    const children = extract(node.children ?? [], id)
    if (children.node) found = children.node
    const columns = node.columns?.map((column) => {
      const result = extract(column.children, id)
      if (result.node) found = result.node
      return { ...column, children: result.nodes }
    })
    return [{ ...node, children: children.nodes, columns }]
  })
  return { nodes: next, node: found }
}

export function moveSiteShellNodeTo(
  nodes: SiteShellNode[],
  id: string,
  parentID: string,
  beforeID?: string,
): SiteShellNode[] {
  const containers = (items: SiteShellNode[]): string[] =>
    items.flatMap((node) =>
      node.type === 'layout'
        ? [
            ...(!['columns', 'spacer', 'divider'].includes(node.layout) && (!node.block || getBlockDefinition(node.block.kind)?.container) ? [node.id] : []),
            ...containers(node.children ?? []),
            ...(node.columns ?? []).flatMap((column) => [
              column.id,
              ...containers(column.children),
            ]),
          ]
        : [],
    )
  const source = findSiteShellNode(nodes, id)
  if (
    !source ||
    id === beforeID ||
    id === parentID ||
    (parentID !== 'root' && !containers(nodes).includes(parentID)) ||
    containers([source]).includes(parentID)
  )
    return nodes
  if (!canInsertAdapterNode(findSiteShellNode(nodes, parentID), source, parentID === 'root')) return nodes
  const result = extract(nodes, id)
  return result.node ? insertSiteShellNode(result.nodes, parentID, result.node, beforeID) : nodes
}
