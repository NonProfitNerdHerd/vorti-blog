import { conditionVisible, publicDocumentFields, readPublicDocumentField } from './presentation'
import { getBlockDefinition } from './registry'
import { walkContent, type ContentNode } from '../content/model'
export type ListingItem = {
  title: string
  url: string
  excerpt?: string
  publishedAt?: string
  image?: string
  taxonomy?: string
}
export type ListingResult = { results: ListingItem[]; page: number; totalPages: number }
export type BlockResolveContext = {
  document: Record<string, unknown>
  now?: number
  preview?: boolean
  list?: (props: Record<string, unknown>, page: number) => Promise<ListingResult>
}
export async function resolveBlocks(
  source: ContentNode[],
  context: BlockResolveContext,
): Promise<ContentNode[]> {
  const resolve = async (items: ContentNode[]): Promise<ContentNode[]> => {
    const result: ContentNode[] = []
    for (const stored of items) {
      const original = structuredClone(stored)
      const definition = getBlockDefinition(original.kind)
      const node =
        definition?.upgrade && (original.blockVersion ?? 1) < definition.version
          ? definition.upgrade(original)
          : original
      const visible = conditionVisible(node.presentation?.condition, context.document, context.now)
      if (!visible && !context.preview) continue
      for (const [key, field] of Object.entries(node.bindings ?? {})) {
        if (
          !definition?.fields.some((item) => item.key === key && item.bindable) ||
          !(publicDocumentFields as readonly string[]).includes(field)
        )
          continue
        node.props = { ...node.props, [key]: readPublicDocumentField(context.document, field) }
      }
      if (node.children) node.children = await resolve(node.children)
      if (node.kind === 'postListing' && context.list)
        node.props = { ...node.props, ...(await context.list(node.props ?? {}, 1)) }
      result.push(node)
    }
    return result
  }
  const result = await resolve(source)
  return resolveDocumentHeadings(result)
}
/** Derived preview data; never write the result back into the document form. */
export function resolveDocumentHeadings(source: ContentNode[]): ContentNode[] {
  const result = structuredClone(source)
  const headings: Array<{ id: string; text: string; level: number }> = []
  for (const node of walkContent(result)) {
    if (node.kind === 'heading' && node.text) {
      node.anchor ||= `heading-${node.id}`
      headings.push({ id: node.anchor, text: node.text, level: node.level ?? 2 })
    }
    if (node.richText && typeof node.richText === 'object') {
      let headingIndex = 0
      const visit = (value: Record<string, unknown>) => {
        if (value.type === 'heading') {
          const anchor = `heading-${node.id}-${++headingIndex}`
          const text = (children: unknown[]): string =>
            children
              .map((raw) => {
                const child = raw as Record<string, unknown>
                return typeof child.text === 'string'
                  ? child.text
                  : text(Array.isArray(child.children) ? child.children : [])
              })
              .join('')
          headings.push({
            id: anchor,
            text: text(Array.isArray(value.children) ? value.children : []),
            level: Number(String(value.tag ?? 'h2').slice(1)),
          })
        }
        for (const child of Array.isArray(value.children) ? value.children : [])
          visit(child as Record<string, unknown>)
      }
      const root = (node.richText as { root?: Record<string, unknown> }).root
      if (root) visit(root)
    }
  }
  for (const node of walkContent(result))
    if (node.kind === 'tableOfContents')
      node.props = {
        ...node.props,
        headings: headings.filter(
          (heading) =>
            heading.level >= Number(node.props?.minLevel ?? 2) &&
            heading.level <= Number(node.props?.maxLevel ?? 6),
        ),
      }
  return result
}
