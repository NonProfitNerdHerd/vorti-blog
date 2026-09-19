import type { BlockDesign, ExportEnvelope, Template } from './types'

export function exportBlockDesign(design: BlockDesign, blockTypeSlug: string): ExportEnvelope<Omit<BlockDesign, 'id' | 'blockType'> & { blockTypeSlug: string }> {
  const { id: _id, blockType: _blockType, ...portable } = design
  return { schemaVersion: 1, kind: 'block-design', item: { ...portable, blockTypeSlug }, dependencies: [blockTypeSlug] }
}

export function exportTemplate(template: Template, designSlugs: Record<string, string>): ExportEnvelope<Omit<Template, 'id' | 'sections'> & { sections: Array<Omit<Template['sections'][number], 'blockDesign'> & { blockDesignSlug: string }> }> {
  const { id: _id, sections, ...portable } = template
  const resolved = sections.map(({ blockDesign, ...section }) => {
    const blockDesignSlug = designSlugs[String(blockDesign)]
    if (!blockDesignSlug) throw new Error(`Missing design slug for ${blockDesign}`)
    return { ...section, blockDesignSlug }
  })
  return { schemaVersion: 1, kind: 'template', item: { ...portable, sections: resolved }, dependencies: [...new Set(resolved.map((section) => section.blockDesignSlug))] }
}

export function validateExport(value: unknown): value is ExportEnvelope<unknown> {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ExportEnvelope<unknown>>
  return item.schemaVersion === 1 && (item.kind === 'block-design' || item.kind === 'template') && !!item.item && Array.isArray(item.dependencies) && item.dependencies.every((dependency) => typeof dependency === 'string')
}
