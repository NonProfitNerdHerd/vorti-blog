import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

describe('Site Template persistence foundation', () => {
  let payload: Payload
  let administratorID: number
  let designerID: number
  let editorID: number
  let templateID: number

  beforeAll(async () => {
    payload = await getPayload({ config })
    const administrator = await payload.create({ collection: 'users', data: { email: 'site-template-admin@example.invalid', password: 'local-validation-password', role: 'administrator' } })
    const designer = await payload.create({ collection: 'users', data: { email: 'site-template-designer@example.invalid', password: 'local-validation-password', role: 'designer' } })
    const editor = await payload.create({ collection: 'users', data: { email: 'site-template-editor@example.invalid', password: 'local-validation-password', role: 'editor' } })
    administratorID = administrator.id
    designerID = designer.id
    editorID = editor.id
    const created = await payload.create({ collection: 'site-templates', data: {
      name: 'Integration Site Template', slug: 'integration-site-template',
      header: { layout: [{ id: 'header-row', type: 'layout', layout: 'row', children: [{ id: 'site-name', type: 'element', element: 'siteName' }] }], settings: { widthMode: 'contained' } },
      footer: { layout: [{ id: 'footer-stack', type: 'layout', layout: 'stack', children: [{ id: 'current-year', type: 'element', element: 'currentYear' }] }], settings: { widthMode: 'full' } },
      assignment: { mode: 'default', priority: 10 }, _status: 'published',
    }, overrideAccess: false, user: designer })
    templateID = created.id
  })

  afterAll(async () => {
    await payload.updateGlobal({ slug: 'site-settings', data: { defaultSiteTemplate: null }, overrideAccess: true })
    if (templateID) await payload.delete({ collection: 'site-templates', id: templateID, overrideAccess: true })
    for (const id of [administratorID, designerID, editorID]) if (id) await payload.delete({ collection: 'users', id, overrideAccess: true })
  })

  it('registers the versioned collection without changing content Template registration', () => {
    const siteTemplate = payload.config.collections.find(({ slug }) => slug === 'site-templates')
    expect(siteTemplate?.versions).toBeTruthy()
    expect(payload.config.collections.some(({ slug }) => slug === 'design-templates')).toBe(true)
  })

  it('persists independent Header and Footer trees', async () => {
    const stored = await payload.findByID({ collection: 'site-templates', id: templateID, depth: 0 })
    expect(stored.header.layout).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'header-row' })]))
    expect(stored.footer.layout).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'footer-stack' })]))
    expect(stored.header.layout).not.toEqual(stored.footer.layout)
  })

  it('keeps draft shell edits private until publication and restores saved trees', async () => {
    const designer = await payload.findByID({ collection: 'users', id: designerID })
    const footerBefore = (await payload.findByID({ collection: 'site-templates', id: templateID, depth: 0 })).footer.layout
    const draftLayout = [{ id: 'draft-header', type: 'layout' as const, layout: 'container' as const, children: [{ id: 'draft-name', type: 'element' as const, element: 'siteName' as const, props: { source: 'siteSettings.siteName' } }] }]
    await payload.update({ collection: 'site-templates', id: templateID, draft: true, overrideAccess: false, user: designer, data: { header: { layout: draftLayout }, _status: 'draft' } })
    const publicVersion = await payload.findByID({ collection: 'site-templates', id: templateID, depth: 0, overrideAccess: false })
    expect(JSON.stringify(publicVersion.header.layout)).not.toContain('draft-header')
    const savedDraft = await payload.findByID({ collection: 'site-templates', id: templateID, depth: 0, draft: true, overrideAccess: false, user: designer })
    expect(savedDraft.header.layout).toEqual(draftLayout)
    expect(savedDraft.footer.layout).toEqual(footerBefore)
    const published = await payload.update({ collection: 'site-templates', id: templateID, overrideAccess: false, user: designer, data: { header: { layout: draftLayout }, _status: 'published' } })
    expect(JSON.stringify(published.header.layout)).toContain('draft-header')
    expect(published.footer.layout).toEqual(footerBefore)
  })

  it('allows published reads but keeps drafts private', async () => {
    const designer = await payload.findByID({ collection: 'users', id: designerID })
    const published = await payload.find({ collection: 'site-templates', where: { id: { equals: templateID } }, overrideAccess: false })
    expect(published.totalDocs).toBe(1)
    const draft = await payload.create({ collection: 'site-templates', draft: true, overrideAccess: false, user: designer, data: {
      name: 'Private Draft Site Template', slug: 'private-draft-site-template', header: { layout: [] }, footer: { layout: [] }, assignment: { mode: 'default', priority: 0 }, _status: 'draft',
    } })
    try {
      const anonymous = await payload.find({ collection: 'site-templates', where: { id: { equals: draft.id } }, overrideAccess: false })
      expect(anonymous.totalDocs).toBe(0)
    } finally {
      await payload.delete({ collection: 'site-templates', id: draft.id, overrideAccess: true })
    }
  })

  it('allows administrators and designers to manage designs but denies editors', async () => {
    const administrator = await payload.findByID({ collection: 'users', id: administratorID })
    const designer = await payload.findByID({ collection: 'users', id: designerID })
    const editor = await payload.findByID({ collection: 'users', id: editorID })
    await payload.update({ collection: 'site-templates', id: templateID, data: { description: 'Administrator update' }, overrideAccess: false, user: administrator })
    await payload.update({ collection: 'site-templates', id: templateID, data: { description: 'Designer update' }, overrideAccess: false, user: designer })
    await expect(payload.update({ collection: 'site-templates', id: templateID, data: { description: 'Editor update' }, overrideAccess: false, user: editor })).rejects.toThrow()
    await expect(payload.updateGlobal({ slug: 'site-settings', data: { siteTagline: 'Editor update' }, overrideAccess: false, user: editor })).rejects.toThrow()
  })

  it('validates Site Shell nodes and Additional CSS', async () => {
    await expect(payload.update({ collection: 'site-templates', id: templateID, data: { header: { layout: [{ id: 'content-field', type: 'field' }] } } })).rejects.toThrow('invalid')
    await expect(payload.update({ collection: 'site-templates', id: templateID, data: { additionalCSS: '@import "remote.css";' } })).rejects.toThrow('invalid')
    await expect(payload.update({ collection: 'site-templates', id: templateID, data: { additionalCSS: '</style><script>bad()</script>' } })).rejects.toThrow('invalid')
  })

  it('stores the authoritative default relationship and prevents deleting it', async () => {
    await payload.updateGlobal({ slug: 'site-settings', data: { defaultSiteTemplate: templateID }, overrideAccess: true })
    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
    expect(settings.defaultSiteTemplate).toBe(templateID)
    await expect(payload.delete({ collection: 'site-templates', id: templateID, overrideAccess: true })).rejects.toThrow('selected as the default')
  })
})
