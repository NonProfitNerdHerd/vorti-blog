import type { Payload } from 'payload'
import type {
  ContentNode,
  ContentLayout,
  Template,
  BlockType,
  BlockDesign,
} from '@design-system/payload-design-core'
import {
  templateContentNodes,
  walkContent,
  validateContentLayout,
} from '@design-system/payload-design-core'
import { mediaURL } from './media'

/** Shared resolver for publication and authenticated draft previews. */
export async function resolveDocumentBlocks(
  payload: Payload,
  document: Record<string, unknown>,
): Promise<ContentNode[] | null> {
  const reference = document.designTemplate
  const templateID =
    reference && typeof reference === 'object' ? (reference as { id: number }).id : reference
  let nodes: ContentNode[]
  const load = async <T>(
    collection: 'design-block-types' | 'design-block-designs',
    id: unknown,
  ): Promise<T> =>
    payload.findByID({
      collection,
      id: id as number,
      depth: 0,
      overrideAccess: false,
    }) as unknown as Promise<T>
  if (templateID) {
    const template = (await payload.findByID({
      collection: 'design-templates',
      id: templateID as number,
      depth: 0,
      overrideAccess: false,
    })) as unknown as Template
    const blockTypes = new Set<unknown>()
    const blockDesigns = new Set<unknown>()
    const visit = (items: NonNullable<Template['layout']>) =>
      items.forEach((node) => {
        if (node.type === 'block') {
          blockTypes.add(node.blockType)
          blockDesigns.add(node.blockDesign)
        }
        if (node.type === 'layout') {
          visit(node.children ?? [])
          node.columns?.forEach((column) => visit(column.children))
        }
      })
    visit(template.layout ?? [])
    template.sections?.forEach((section) => {
      blockTypes.add(section.blockType)
      blockDesigns.add(section.blockDesign)
    })
    const [types, designs] = await Promise.all([
      Promise.all([...blockTypes].map((id) => load<BlockType>('design-block-types', id))),
      Promise.all([...blockDesigns].map((id) => load<BlockDesign>('design-block-designs', id))),
    ])
    nodes = templateContentNodes(template, document, types, designs)
  } else if (document.contentLayout) {
    const valid = validateContentLayout(document.contentLayout)
    if (valid !== true) throw new Error(valid)
    nodes = (document.contentLayout as ContentLayout).nodes
  } else return null
  const mediaCache = new Map<string, Promise<unknown>>()
  const media = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(media))
    if (!value) return value
    if (typeof value === 'object') return { ...value, url: mediaURL(value as never) }
    const key = String(value)
    if (!mediaCache.has(key))
      mediaCache.set(
        key,
        payload
          .findByID({ collection: 'media', id: value as number, depth: 0, overrideAccess: false })
          .then((value) => ({ ...value, url: mediaURL(value) }))
          .catch((): null => null),
      )
    return mediaCache.get(key)
  }
  const result = structuredClone(nodes)
  await Promise.all(
    walkContent(result).map(async (node) => {
      if (node.media) node.media = await media(node.media)
      if (node.kind === 'designed') {
        try {
          const [type, design] = await Promise.all([
            load<BlockType>('design-block-types', node.blockType),
            load<BlockDesign>('design-block-designs', node.blockDesign),
          ])
          node.rendererKey = type.rendererKey
          node.design = design.design
        } catch {
          node.rendererKey = undefined
        }
        node.values = Object.fromEntries(
          await Promise.all(
            Object.entries(node.values ?? {}).map(async ([key, value]) => [
              key,
              /image/i.test(key) ? await media(value) : value,
            ]),
          ),
        )
      }
      // Template field metadata belongs to the admin, not the published component tree.
      delete node.binding
      delete node.fields
    }),
  )
  return result
}
