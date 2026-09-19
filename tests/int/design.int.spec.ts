import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { createPayloadDesignStore, createPayloadDependencySource, getBlockDesignDependencies, resolveContentTemplate, validateTemplatedContent } from '@design-system/payload-design-core'
import { heroBoardFields, heroBoardDesigns } from '@design-system/payload-design-core/hero-board/registration'
import { isDesignManager } from '@/access/design'
import { resolvePostDesign } from '@/lib/post-design'
import { PostDesignSections } from '@/components/PostDesignSections'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

describe('Design Core integration', () => {
  let payload: Payload
  let typeID: number
  let featureID: number
  let splitID: number
  let templateID: number
  const values = { hero: { headline: 'Original Headline', subheadline: 'Unchanged summary', primaryCTA: { label: 'Learn More', url: '/example' } } }

  it('renders structured Template Lexical content without exposing JSON', () => {
    const lexical = { root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children: [
      { type: 'heading', tag: 'h2', version: 1, direction: 'ltr', format: '', indent: 0, children: [{ type: 'text', text: 'Newsletter Heading', format: 0, detail: 0, mode: 'normal', style: '', version: 1 }] },
      { type: 'paragraph', version: 1, direction: 'ltr', format: '', indent: 0, children: [{ type: 'text', text: 'Bold words', format: 1, detail: 0, mode: 'normal', style: '', version: 1 }, { type: 'link', version: 3, fields: { linkType: 'custom', url: '/story', newTab: false }, children: [{ type: 'text', text: ' linked story', format: 0, detail: 0, mode: 'normal', style: '', version: 1 }], direction: 'ltr', format: '', indent: 0 }] },
      { type: 'list', listType: 'bullet', tag: 'ul', start: 1, version: 1, direction: 'ltr', format: '', indent: 0, children: [{ type: 'listitem', value: 1, version: 1, direction: 'ltr', format: '', indent: 0, children: [{ type: 'text', text: 'List item', format: 0, detail: 0, mode: 'normal', style: '', version: 1 }] }] },
    ] } }
    const markup = renderToStaticMarkup(createElement(PostDesignSections, { sections: [{ key: 'story', kind: 'field', fieldType: 'richText', label: 'Story', value: lexical }] }))
    expect(markup).toContain('<h2>Newsletter Heading</h2>')
    expect(markup).toContain('<strong>Bold words</strong>')
    expect(markup).toContain('href="/story"')
    expect(markup).toContain('<ul')
    expect(markup).not.toContain('&quot;root&quot;')
  })

  beforeAll(async () => {
    payload = await getPayload({ config })
    const type = await payload.create({ collection: 'design-block-types', data: {
      name: 'Hero Board Test', slug: 'hero-board-test', rendererKey: 'hero-board', schemaVersion: 1, status: 'published', _status: 'published', fields: heroBoardFields as never,
    } })
    typeID = type.id
    const feature = await payload.create({ collection: 'design-block-designs', data: {
      name: 'Feature Test', slug: 'feature-test', blockType: typeID, status: 'published', _status: 'published', design: heroBoardDesigns[3].design as never,
    } })
    featureID = feature.id
    const split = await payload.create({ collection: 'design-block-designs', data: {
      name: 'Split Test', slug: 'split-test', blockType: typeID, status: 'published', _status: 'published', design: heroBoardDesigns[2].design as never,
    } })
    splitID = split.id
    const template = await payload.create({ collection: 'design-templates', data: {
      name: 'Test Template', slug: 'test-template', status: 'published', _status: 'published', allowedCollections: ['posts'],
      sections: [{ key: 'hero', name: 'Hero', blockType: typeID, blockDesign: featureID, required: true }],
    } })
    templateID = template.id
  })

  afterAll(async () => {
    if (templateID) await payload.delete({ collection: 'design-templates', id: templateID })
    if (featureID) await payload.delete({ collection: 'design-block-designs', id: featureID })
    if (splitID) await payload.delete({ collection: 'design-block-designs', id: splitID })
    if (typeID) await payload.delete({ collection: 'design-block-types', id: typeID })
  })

  it('separates designer permissions from editor permissions', async () => {
    expect(isDesignManager({ role: 'administrator' })).toBe(true)
    expect(isDesignManager({ role: 'designer' })).toBe(true)
    expect(isDesignManager({ role: 'editor' })).toBe(false)
    expect(isDesignManager(null)).toBe(false)
    const editor = await payload.create({ collection: 'users', data: { email: 'design-editor-test@example.invalid', password: 'local-validation-password', role: 'editor' } })
    try {
      await expect(payload.update({ collection: 'design-block-designs', id: featureID, data: { name: 'Unauthorized edit' }, overrideAccess: false, user: editor })).rejects.toThrow()
      await expect(payload.update({ collection: 'design-templates', id: templateID, data: { name: 'Unauthorized edit' }, overrideAccess: false, user: editor })).rejects.toThrow()
      const published = await payload.findByID({ collection: 'design-block-designs', id: featureID, overrideAccess: false, user: editor })
      expect(published.name).toBe('Feature Test')
      const body = { root: { type: 'root' as const, format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
        children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
          children: [{ type: 'text', text: 'Editor body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }] } }
      const post = await payload.create({ collection: 'posts', overrideAccess: false, user: editor, data: {
        title: 'Editor Template Post', slug: 'editor-template-post', author: editor.id, content: body,
        designTemplate: templateID, templateValues: values, _status: 'published',
      } })
      await payload.delete({ collection: 'posts', id: post.id })
    } finally {
      await payload.delete({ collection: 'users', id: editor.id })
    }
  })

  it('validates Hero Board content values using the referenced Block Type', async () => {
    const store = createPayloadDesignStore(payload)
    expect(await validateTemplatedContent(store, { id: 1, template: templateID, templateValues: values })).toEqual([])
    expect(await validateTemplatedContent(store, { id: 1, template: templateID, templateValues: { hero: { subheadline: 'Missing headline' } } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'templateValues.hero.headline' }),
    ]))
  })

  it('preserves content while published design and template references change', async () => {
    const store = createPayloadDesignStore(payload)
    const content = { id: 77, template: templateID, templateValues: structuredClone(values) }
    const initial = await resolveContentTemplate(store, content)
    expect(initial.sections[0].blockDesign.id).toBe(featureID)
    expect(initial.sections[0].values.headline).toBe('Original Headline')

    await payload.update({ collection: 'design-block-designs', id: featureID, draft: true, data: { design: { ...heroBoardDesigns[3].design, alignment: 'right' } } })
    expect((await resolveContentTemplate(store, content)).sections[0].blockDesign.design.alignment).toBe(heroBoardDesigns[3].design.alignment)
    await payload.update({ collection: 'design-block-designs', id: featureID, data: { _status: 'published', design: { ...heroBoardDesigns[3].design, alignment: 'right' } } })
    expect((await resolveContentTemplate(store, content)).sections[0].blockDesign.design.alignment).toBe('right')

    await payload.update({ collection: 'design-templates', id: templateID, draft: true, data: { sections: [{ key: 'hero', name: 'Hero', blockType: typeID, blockDesign: splitID, required: true }] } })
    expect((await resolveContentTemplate(store, content)).sections[0].blockDesign.id).toBe(featureID)
    await payload.update({ collection: 'design-templates', id: templateID, data: { _status: 'published', sections: [{ key: 'hero', name: 'Hero', blockType: typeID, blockDesign: splitID, required: true }] } })
    const next = await resolveContentTemplate(store, content)
    expect(next.sections[0].blockDesign.id).toBe(splitID)
    expect(next.sections[0].values).toEqual(values.hero)
    expect(content.templateValues).toEqual(values)
  })

  it('reports dependencies and prevents deletion of referenced designs', async () => {
    const source = createPayloadDependencySource(payload, [])
    const dependencies = await getBlockDesignDependencies(source, splitID)
    expect(dependencies.templates).toEqual(expect.arrayContaining([expect.objectContaining({ id: templateID })]))
    await expect(payload.delete({ collection: 'design-block-designs', id: splitID })).rejects.toThrow('referenced')
    await expect(payload.update({ collection: 'design-block-designs', id: splitID, data: { status: 'archived' } })).rejects.toThrow('referenced')
    await expect(payload.delete({ collection: 'design-block-types', id: typeID })).rejects.toThrow('referenced')
  })

  it('resolves a real Post through published Template and Design changes', async () => {
    const author = await payload.create({ collection: 'users', data: { email: 'stage3-post@example.invalid', password: 'local-validation-password', role: 'editor' } })
    const classic = await payload.create({ collection: 'design-block-designs', data: {
      name: 'Classic Test', slug: 'classic-stage3-test', blockType: typeID, status: 'published', _status: 'published', design: { alignment: 'left' },
    } })
    const content = { root: { type: 'root' as const, format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
      children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
        children: [{ type: 'text', text: 'Post body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }] } }
    await payload.update({ collection: 'design-templates', id: templateID, data: { _status: 'published', sections: [{ key: 'hero', name: 'Hero', blockType: typeID, blockDesign: featureID, required: true, allowDesignOverride: true }] } })
    const post = await payload.create({ collection: 'posts', data: { title: 'Stage 3 Post', slug: 'stage3-post', author: author.id,
      content, designTemplate: templateID, templateValues: values, designOverrides: { hero: null }, _status: 'published' } })
    const store = createPayloadDesignStore(payload)
    async function resolved() {
      const current = await payload.findByID({ collection: 'posts', id: post.id, depth: 0 })
      return resolveContentTemplate(store, { id: current.id, template: templateID,
        templateValues: current.templateValues as typeof values, designOverrides: current.designOverrides as Record<string, number | null> })
    }
    try {
      expect((await resolved()).sections[0].blockDesign.id).toBe(featureID)
      const markup = renderToStaticMarkup(createElement(PostDesignSections, { sections: await resolvePostDesign(post) }))
      expect(markup).toContain('Original Headline')
      expect(markup).toContain('hero-board')
      await payload.update({ collection: 'design-block-designs', id: featureID, data: { _status: 'published', design: { alignment: 'center' } } })
      expect((await resolved()).sections[0].blockDesign.design.alignment).toBe('center')
      await payload.update({ collection: 'design-templates', id: templateID, draft: true, data: { sections: [{ key: 'hero', name: 'Hero', blockType: typeID, blockDesign: splitID, required: true, allowDesignOverride: true }] } })
      expect((await resolved()).sections[0].blockDesign.id).toBe(featureID)
      await payload.update({ collection: 'design-templates', id: templateID, data: { _status: 'published', sections: [{ key: 'hero', name: 'Hero', blockType: typeID, blockDesign: splitID, required: true, allowDesignOverride: true }] } })
      expect((await resolved()).sections[0].blockDesign.id).toBe(splitID)
      await payload.update({ collection: 'posts', id: post.id, data: { designOverrides: { hero: classic.id } } })
      expect((await resolved()).sections[0].blockDesign.id).toBe(classic.id)
      await payload.update({ collection: 'design-block-designs', id: classic.id, data: { _status: 'published', design: { alignment: 'right' } } })
      expect((await resolved()).sections[0].blockDesign.design.alignment).toBe('right')
      expect((await resolved()).sections[0].values.headline).toBe('Original Headline')
      await payload.update({ collection: 'design-templates', id: templateID, data: { _status: 'published', sections: [
        { key: 'hero', name: 'Hero', blockType: typeID, blockDesign: splitID, required: true, allowDesignOverride: true },
        { key: 'introduction', name: 'Introduction', blockType: typeID, blockDesign: featureID, required: true },
      ] } })
      expect((await resolved()).sections).toHaveLength(2)
      expect((await resolved()).sections[1].values).toEqual({})
      await expect(payload.update({ collection: 'posts', id: post.id, data: { title: 'Should require Introduction' } })).rejects.toThrow('headline')
      await payload.update({ collection: 'design-templates', id: templateID, data: { _status: 'published', sections: [] } })
      expect((await resolved()).sections).toHaveLength(0)
      const stored = await payload.findByID({ collection: 'posts', id: post.id, depth: 0 })
      expect((stored.templateValues as typeof values).hero.headline).toBe('Original Headline')
    } finally {
      await payload.delete({ collection: 'posts', id: post.id })
      await payload.delete({ collection: 'design-block-designs', id: classic.id })
      await payload.delete({ collection: 'users', id: author.id })
    }
  }, 20_000)
})
