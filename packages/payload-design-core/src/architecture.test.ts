import { describe, expect, it } from 'vitest'
import { assertDesignCanDelete, getBlockDesignDependencies } from './dependencies'
import { resolveContentTemplate } from './resolver'
import type { BlockDesign, BlockType, Template, TemplatedContent } from './types'

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
    publishTemplate: () => { if (draftTemplate) Object.assign(currentTemplate, draftTemplate) },
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
    expect(f.currentContent.templateValues?.hero.headline).toBe('Original Headline')
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
})
