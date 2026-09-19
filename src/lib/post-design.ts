import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Post } from '@/payload-types'
import { createPayloadDesignStore, resolveContentTemplate } from '@design-system/payload-design-core'
import type { TemplateNode } from '@design-system/payload-design-core'
import type { HeroBoardValues } from '@design-system/payload-design-core/hero-board'
import { mediaURL } from './media'

export type PostDesignSection =
  | { key: string; kind: 'block'; rendererKey: string; design: Record<string, unknown>; values: HeroBoardValues }
  | { key: string; kind: 'field'; fieldType: string; label: string; value: unknown }
  | { key: string; kind: 'layout'; layout: string; children?: PostDesignSection[]; columns?: Array<{ id: string; width: number; children: PostDesignSection[] }> }

export async function resolvePostDesign(post: Post): Promise<PostDesignSection[]> {
  const reference = post.designTemplate
  const template = typeof reference === 'object' && reference !== null ? reference.id : reference as string | number | undefined
  if (!template) return []
  const payload = await getPayload({ config })
  const values = (post.templateValues ?? {}) as Record<string, unknown>
  const pendingOverrides = (values.__designOverrides ?? {}) as Record<string, string | number | null>
  const resolved = await resolveContentTemplate(createPayloadDesignStore(payload), { id: post.id, template, templateValues: values as never, designOverrides: { ...((post.designOverrides ?? {}) as Record<string, string | number | null>), ...pendingOverrides } })
  async function mediaValue(reference: unknown) { try { const media = typeof reference === 'object' ? reference : await payload.findByID({ collection: 'media', id: Number(reference), depth: 0, overrideAccess: false }); return { url: mediaURL(media as never) ?? '', alt: (media as { alt?: string }).alt ?? '' } } catch { return null } }
  const blockMap = new Map(resolved.blocks.map((block) => [block.id, block]))
  async function renderNodes(nodes: TemplateNode[]): Promise<PostDesignSection[]> { return Promise.all(nodes.map(async (node): Promise<PostDesignSection> => {
    if (node.type === 'field') { let value = values[node.id]; if (node.fieldType === 'image' && value) value = await mediaValue(value); if (node.fieldType === 'images' && Array.isArray(value)) value = await Promise.all(value.map(mediaValue)); return { key: node.id, kind: 'field', fieldType: node.fieldType, label: node.label, value } }
    if (node.type === 'layout') return { key: node.id, kind: 'layout', layout: node.layout, children: await renderNodes(node.children ?? []), columns: await Promise.all((node.columns ?? []).map(async (column) => ({ id: column.id, width: column.width, children: await renderNodes(column.children) }))) }
    const block = blockMap.get(node.id); const mapped: Record<string, unknown> = {}; for (const [slot, fieldID] of Object.entries(node.slotMappings)) mapped[slot] = values[fieldID]; for (const key of ['backgroundImage', 'foregroundImage']) if (mapped[key]) mapped[key] = await mediaValue(mapped[key]); return { key: node.id, kind: 'block', rendererKey: block?.blockTypeDoc.rendererKey ?? '', design: block?.blockDesignDoc.design ?? {}, values: mapped as HeroBoardValues }
  })) }
  const modern = await renderNodes(resolved.layout)
  const legacy = await Promise.all(resolved.sections.map(async (section): Promise<PostDesignSection> => { const sectionValues = { ...section.values }; for (const key of ['backgroundImage', 'foregroundImage']) if (sectionValues[key]) sectionValues[key] = await mediaValue(sectionValues[key]); return { key: section.key, kind: 'block', rendererKey: section.blockType.rendererKey, design: section.blockDesign.design, values: sectionValues as HeroBoardValues } }))
  return [...legacy, ...modern]
}
