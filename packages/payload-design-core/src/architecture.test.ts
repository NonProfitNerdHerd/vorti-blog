import { describe, expect, it } from 'vitest'
import { assertDesignCanDelete, getBlockDesignDependencies } from './dependencies'
import { resolveContentTemplate } from './resolver'
import { validateTemplatedContent } from './validation'
import type { BlockDesign, BlockType, Template, TemplateLayoutNode, TemplatedContent } from './types'

const type: BlockType = { id: 1, slug: 'hero', name: 'Hero', rendererKey: 'hero', status: 'published', _status: 'published', fields: [{ key: 'headline', label: 'Headline', kind: 'text' }] }
const designs = new Map<number, BlockDesign>([
  [4, { id: 4, slug: 'hero-4', name: 'Hero 4', blockType: 1, status: 'published', _status: 'published', design: { tone: 'neutral' } }],
  [3, { id: 3, slug: 'hero-3', name: 'Hero 3', blockType: 1, status: 'published', _status: 'published', design: { tone: 'accent' } }],
])
const template: Template = { id: 2, slug: 'newsletter', name: 'Newsletter', status: 'published', _status: 'published', allowedCollections: ['posts'], sections: [{ key: 'hero', name: 'Hero', blockType: 1, blockDesign: 4, required: true }] }
const content: TemplatedContent = { id: 10, template: 2, templateValues: { hero: { headline: 'Original Headline' } } }

function fixture() {
  const currentDesigns = new Map([...designs].map(([id, design]) => [id, structuredClone(design)]))
  const currentTemplate = structuredClone(template)
  const currentContent = structuredClone(content)
  const draftDesigns = new Map<number, BlockDesign>()
  let draftTemplate: Template | undefined
  return {
    currentDesigns, currentTemplate, currentContent, draftDesigns,
    publishTemplate: () => { if (draftTemplate) Object.assign(currentTemplate, draftTemplate, { _status: 'published', status: 'published' }) },
    setDraftTemplate: (value: Template) => { draftTemplate = value },
    store: {
      getTemplate: async (_id: number | string, mode: 'published' | 'draft') => mode === 'draft' && draftTemplate ? draftTemplate : currentTemplate,
      getBlockDesign: async (id: number | string, mode: 'published' | 'draft') => mode === 'draft' && draftDesigns.has(Number(id)) ? draftDesigns.get(Number(id))! : currentDesigns.get(Number(id)) ?? null,
      getBlockType: async () => type,
    },
  }
}

describe('live references and publication', () => {
  it('A/C: published design changes flow to content without changing content values', async () => {
    const f = fixture()
    expect((await resolveContentTemplate(f.store, f.currentContent)).sections[0].blockDesign.design.tone).toBe('neutral')
    f.currentDesigns.get(4)!.design.tone = 'accent'
    const result = await resolveContentTemplate(f.store, f.currentContent)
    expect(result.sections[0].blockDesign.design.tone).toBe('accent')
    expect(result.sections[0].values.headline).toBe('Original Headline')
    expect((f.currentContent.templateValues?.hero as { headline: string }).headline).toBe('Original Headline')
  })

  it('B: published template changes flow to content without modifying it', async () => {
    const f = fixture()
    f.currentTemplate.sections[0].blockDesign = 3
    expect((await resolveContentTemplate(f.store, f.currentContent)).sections[0].blockDesign.slug).toBe('hero-3')
    expect(f.currentContent.template).toBe(2)
  })

  it('D: draft design changes stay out of production resolution', async () => {
    const f = fixture()
    f.draftDesigns.set(4, { ...f.currentDesigns.get(4)!, design: { tone: 'accent' }, _status: 'draft' })
    expect((await resolveContentTemplate(f.store, f.currentContent)).sections[0].blockDesign.design.tone).toBe('neutral')
    expect((await resolveContentTemplate(f.store, f.currentContent, 'draft')).sections[0].blockDesign.design.tone).toBe('accent')
  })

  it('E: draft template changes stay out of production resolution', async () => {
    const f = fixture()
    f.setDraftTemplate({ ...f.currentTemplate, _status: 'draft', sections: [{ ...f.currentTemplate.sections[0], blockDesign: 3 }] })
    expect((await resolveContentTemplate(f.store, f.currentContent)).sections[0].blockDesign.slug).toBe('hero-4')
    expect((await resolveContentTemplate(f.store, f.currentContent, 'draft')).sections[0].blockDesign.slug).toBe('hero-3')
  })

  it('F/G: rejects referenced design deletion and reports dependent content', async () => {
    const source = {
      templatesUsingDesign: async () => [{ id: 2, name: 'Newsletter' }],
      contentUsingTemplate: async () => [{ collection: 'posts', id: 10 }],
    }
    await expect(assertDesignCanDelete(source, 4)).rejects.toThrow('referenced')
    expect(await getBlockDesignDependencies(source, 4)).toEqual({ templates: [{ id: 2, name: 'Newsletter' }], content: [{ collection: 'posts', id: 10 }] })
  })

  it('permits only same-type design variants when a Template allows overrides', async () => {
    const f = fixture()
    const overridden = { ...f.currentContent, designOverrides: { hero: 3 } }
    await expect(resolveContentTemplate(f.store, overridden)).rejects.toThrow('not allowed')
    f.currentTemplate.sections[0].allowDesignOverride = true
    const result = await resolveContentTemplate(f.store, overridden)
    expect(result.sections[0].blockDesign.id).toBe(3)
    expect(result.sections[0].values.headline).toBe('Original Headline')
    expect(f.currentContent.designOverrides).toBeUndefined()
  })

  it('rejects a default Design from a different Block Type', async () => {
    const f = fixture()
    f.currentTemplate.sections[0].blockType = 999
    await expect(resolveContentTemplate(f.store, f.currentContent)).rejects.toThrow('must belong')
  })

  it('resolves Template fields and Hero slot mappings without copying layout into content', async () => {
    const f = fixture()
    f.currentTemplate.layout = [{ id: 'hero-node', type: 'block', name: 'Hero Board', blockType: 1, blockDesign: 4, fields: [
      { id: 'issue-title', type: 'field', fieldType: 'shortText', label: 'Issue Title', required: true },
    ], slotMappings: { headline: 'issue-title' } }, { id: 'row', type: 'layout', layout: 'columns', columns: [
      { id: 'left', width: 60, children: [{ id: 'main-story', type: 'field', fieldType: 'richText', label: 'Main Story' }] },
      { id: 'right', width: 40, children: [{ id: 'story-image', type: 'field', fieldType: 'image', label: 'Story Image' }] },
    ] }, { id: 'gallery', type: 'field', fieldType: 'images', label: 'Issue Photos' }]
    const lexicalStory = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Story' }] }] } }
    const content = { ...f.currentContent, templateValues: { hero: { headline: 'Legacy' }, 'issue-title': 'November 2026', 'main-story': lexicalStory, 'story-image': 12, gallery: [12, 13] } }
    const resolved = await resolveContentTemplate(f.store, content)
    expect(resolved.layout).toBe(f.currentTemplate.layout)
    expect(resolved.blocks[0].blockDesignDoc.id).toBe(4)
    expect(content).not.toHaveProperty('layout')
    f.currentTemplate.layout[1] = { ...(f.currentTemplate.layout[1] as TemplateLayoutNode), columns: [
      { id: 'left', width: 70, children: [{ id: 'main-story', type: 'field', fieldType: 'richText', label: 'Feature Story' }] }, { id: 'right', width: 30, children: [] },
    ] }
    expect(((await resolveContentTemplate(f.store, content)).template.layout?.[1] as TemplateLayoutNode).columns?.[0].width).toBe(70)
    expect(content.templateValues['main-story']).toEqual(lexicalStory)
    const storedValues = structuredClone(content.templateValues)
    f.setDraftTemplate({ ...f.currentTemplate, _status: 'draft', layout: [{ ...(f.currentTemplate.layout[0] as Extract<NonNullable<Template['layout']>[number], { type: 'block' }>), blockDesign: 3 }, {
      ...(f.currentTemplate.layout[1] as TemplateLayoutNode), columns: [{ id: 'left', width: 70, children: [] }, { id: 'right', width: 30, children: [{ id: 'main-story', type: 'field', fieldType: 'richText', label: 'Feature Story' }, { id: 'story-image', type: 'field', fieldType: 'image', label: 'Story Image' }] }],
    }, f.currentTemplate.layout[2]] })
    expect((await resolveContentTemplate(f.store, content)).blocks[0].blockDesignDoc.id).toBe(4)
    f.publishTemplate()
    const changed = await resolveContentTemplate(f.store, content)
    expect(changed.blocks[0].blockDesignDoc.id).toBe(3)
    expect((changed.layout[1] as TemplateLayoutNode).columns?.map((column) => column.width)).toEqual([70, 30])
    expect(content.templateValues).toEqual(storedValues)
    f.currentDesigns.get(3)!.design.alignment = 'right'
    expect((await resolveContentTemplate(f.store, content)).blocks[0].blockDesignDoc.design.alignment).toBe('right')
    ;(f.currentTemplate.layout?.[1] as TemplateLayoutNode).columns?.[1].children.push({ id: 'new-required', type: 'field', fieldType: 'shortText', label: 'New Required Field', required: true })
    expect(await validateTemplatedContent(f.store, content)).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'templateValues.new-required' })]))
    ;(f.currentTemplate.layout?.[1] as TemplateLayoutNode).columns?.[1].children.pop()
    expect(content.templateValues['main-story']).toEqual(lexicalStory)
    expect(content.templateValues['story-image']).toBe(12)
    expect(content.templateValues.gallery).toEqual([12, 13])
  })
})
