import type { TemplateField, TemplateNode } from './types'

export function walkTemplate(nodes: TemplateNode[], visit: (node: TemplateNode, parent: string | null) => void, parent: string | null = null): void {
  for (const node of nodes) {
    visit(node, parent)
    if (node.type === 'layout') {
      walkTemplate(node.children ?? [], visit, node.id)
      for (const column of node.columns ?? []) walkTemplate(column.children, visit, column.id)
    }
    if (node.type === 'block') for (const field of node.fields) visit(field, node.id)
  }
}

export function templateFields(nodes: TemplateNode[]): TemplateField[] {
  const fields: TemplateField[] = []
  walkTemplate(nodes, (node) => { if (node.type === 'field') fields.push(node) })
  return fields
}

export function findTemplateNode(nodes: TemplateNode[], id: string): TemplateNode | null {
  let match: TemplateNode | null = null
  walkTemplate(nodes, (node) => { if (node.id === id) match = node })
  return match
}

export function updateTemplateNode(nodes: TemplateNode[], id: string, update: (node: TemplateNode) => TemplateNode): TemplateNode[] {
  return nodes.map((node) => {
    if (node.id === id) return update(node)
    if (node.type !== 'layout') return node
    return { ...node,
      children: node.children ? updateTemplateNode(node.children, id, update) : undefined,
      columns: node.columns?.map((column) => ({ ...column, children: updateTemplateNode(column.children, id, update) })),
    }
  })
}

export function removeTemplateNode(nodes: TemplateNode[], id: string): TemplateNode[] {
  return nodes.filter((node) => node.id !== id).map((node) => node.type === 'layout' ? {
    ...node, children: node.children ? removeTemplateNode(node.children, id) : undefined,
    columns: node.columns?.map((column) => ({ ...column, children: removeTemplateNode(column.children, id) })),
  } : node)
}

export function moveTemplateNode(nodes: TemplateNode[], id: string, direction: -1 | 1): TemplateNode[] {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) {
    const target = index + direction
    if (target < 0 || target >= nodes.length) return nodes
    const next = [...nodes]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  }
  return nodes.map((node) => node.type === 'layout' ? {
    ...node, children: node.children ? moveTemplateNode(node.children, id, direction) : undefined,
    columns: node.columns?.map((column) => ({ ...column, children: moveTemplateNode(column.children, id, direction) })),
  } : node)
}

export function collectFieldIDs(nodes: TemplateNode[]): string[] { return templateFields(nodes).map((field) => field.id) }

export function extractTemplateNode(nodes: TemplateNode[], id: string): { nodes: TemplateNode[]; extracted: TemplateNode | null } {
  let extracted: TemplateNode | null = null
  const next = nodes.flatMap((node): TemplateNode[] => {
    if (node.id === id) { extracted = node; return [] }
    if (node.type !== 'layout') return [node]
    const childResult = extractTemplateNode(node.children ?? [], id)
    if (childResult.extracted) extracted = childResult.extracted
    const columns = node.columns?.map((column) => {
      const result = extractTemplateNode(column.children, id)
      if (result.extracted) extracted = result.extracted
      return { ...column, children: result.nodes }
    })
    return [{ ...node, children: childResult.nodes, columns }]
  })
  return { nodes: next, extracted }
}

export function insertTemplateNode(nodes: TemplateNode[], containerID: string, nodeToInsert: TemplateNode): TemplateNode[] {
  if (containerID === 'root') return [...nodes, nodeToInsert]
  return nodes.map((node) => {
    if (node.type !== 'layout') return node
    if (node.id === containerID && node.layout !== 'columns') return { ...node, children: [...(node.children ?? []), nodeToInsert] }
    return { ...node,
      children: insertTemplateNode(node.children ?? [], containerID, nodeToInsert),
      columns: node.columns?.map((column) => column.id === containerID ? { ...column, children: [...column.children, nodeToInsert] } : { ...column, children: insertTemplateNode(column.children, containerID, nodeToInsert) }),
    }
  })
}

export function moveTemplateNodeTo(nodes: TemplateNode[], id: string, containerID: string): TemplateNode[] {
  const result = extractTemplateNode(nodes, id)
  return result.extracted ? insertTemplateNode(result.nodes, containerID, result.extracted) : nodes
}
