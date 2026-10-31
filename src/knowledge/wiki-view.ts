export type WikiView = 'read' | 'edit' | 'history'
export function wikiView(value: unknown, manage?: unknown): WikiView {
  return value === 'edit' || value === 'history' || value === 'read'
    ? value
    : manage === '1'
      ? 'edit'
      : 'read'
}
export function wikiLoginURL(destination: string) {
  let safe = '/admin'
  try {
    const decoded = decodeURIComponent(destination)
    if (
      !/[\\\u0000-\u0020]/.test(decoded) &&
      /^\/(?:sites\/[a-zA-Z0-9_-]+\/)?wiki(?:[/?#]|$)/.test(decoded) &&
      !decoded.startsWith('//')
    )
      safe = destination
  } catch {
    /* Malformed return paths use the admin dashboard. */
  }
  return `/admin/login?${new URLSearchParams({ redirect: safe })}`
}
export interface WikiNode {
  type: string
  text?: string
  format?: number
  tag?: string
  listType?: string
  url?: string
  fields?: { url?: string }
  children?: WikiNode[]
}
export function wikiOutline(body: unknown) {
  const headings: Array<{ id: string; title: string; level: number; node: WikiNode }> = [],
    counts = new Map<string, number>(),
    used = new Set<string>()
  const text = (node: WikiNode): string => node.text || node.children?.map(text).join('') || ''
  const visit = (node: WikiNode) => {
    if (node.type === 'heading') {
      const title = text(node).trim(),
        base =
          title
            .toLocaleLowerCase('en')
            .normalize('NFKC')
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-|-$/g, '') || 'section'
      let count = (counts.get(base) || 0) + 1
      let id = `wiki-${base}${count > 1 ? `-${count}` : ''}`
      while (used.has(id)) {
        count++
        id = `wiki-${base}-${count}`
      }
      counts.set(base, count)
      used.add(id)
      headings.push({
        id,
        title: title || 'Section',
        level: Math.max(2, Math.min(6, Number(node.tag?.slice(1)) || 2)),
        node,
      })
    }
    node.children?.forEach(visit)
  }
  if (body && typeof body === 'object' && 'root' in body) visit((body as { root: WikiNode }).root)
  return headings
}
