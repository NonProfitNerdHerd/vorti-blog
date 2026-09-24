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

export function updateSiteShellNode(nodes: SiteShellNode[], id: string, next: SiteShellNode): SiteShellNode[] {
  return nodes.map((node) => node.id === id ? next : node.type === 'layout' ? {
    ...node,
    children: node.children ? updateSiteShellNode(node.children, id, next) : undefined,
    columns: node.columns?.map((column) => ({ ...column, children: updateSiteShellNode(column.children, id, next) })),
  } : node)
}

export function removeSiteShellNode(nodes: SiteShellNode[], id: string): SiteShellNode[] {
  return nodes.filter((node) => node.id !== id).map((node) => node.type === 'layout' ? {
    ...node,
    children: node.children ? removeSiteShellNode(node.children, id) : undefined,
    columns: node.columns?.map((column) => ({ ...column, children: removeSiteShellNode(column.children, id) })),
  } : node)
}

export function insertSiteShellNode(nodes: SiteShellNode[], parentID: string, inserted: SiteShellNode): SiteShellNode[] {
  if (parentID === 'root') return [...nodes, inserted]
  return nodes.map((node) => {
    if (node.type !== 'layout') return node
    if (node.id === parentID && node.layout !== 'columns') return { ...node, children: [...(node.children ?? []), inserted] }
    return {
      ...node,
      children: insertSiteShellNode(node.children ?? [], parentID, inserted),
      columns: node.columns?.map((column) => column.id === parentID
        ? { ...column, children: [...column.children, inserted] }
        : { ...column, children: insertSiteShellNode(column.children, parentID, inserted) }),
    }
  })
}

export function moveSiteShellNode(nodes: SiteShellNode[], id: string, direction: -1 | 1): SiteShellNode[] {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) {
    const target = index + direction
    if (target < 0 || target >= nodes.length) return nodes
    const copy = [...nodes]
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
    return copy
  }
  return nodes.map((node) => node.type === 'layout' ? {
    ...node,
    children: moveSiteShellNode(node.children ?? [], id, direction),
    columns: node.columns?.map((column) => ({ ...column, children: moveSiteShellNode(column.children, id, direction) })),
  } : node)
}

function extract(nodes: SiteShellNode[], id: string): { nodes: SiteShellNode[]; node: SiteShellNode | null } {
  let found: SiteShellNode | null = null
  const next = nodes.flatMap((node): SiteShellNode[] => {
    if (node.id === id) { found = node; return [] }
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

export function moveSiteShellNodeTo(nodes: SiteShellNode[], id: string, parentID: string): SiteShellNode[] {
  if (id === parentID || findSiteShellNode([findSiteShellNode(nodes, id)!].filter(Boolean), parentID)) return nodes
  const result = extract(nodes, id)
  return result.node ? insertSiteShellNode(result.nodes, parentID, result.node) : nodes
}
