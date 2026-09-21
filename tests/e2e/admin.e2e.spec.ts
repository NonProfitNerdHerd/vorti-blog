import { test, expect, Page, type APIRequestContext } from '@playwright/test'
import { login } from '../helpers/login'
import { testUser } from '../helpers/seedUser'
import { heroBoardFields, heroBoardDesigns } from '@design-system/payload-design-core/hero-board/registration'

const apiURL = 'http://localhost:3000/api'
async function createDoc(api: APIRequestContext, collection: string, data: Record<string, unknown>, draft = false): Promise<{ id: number }> {
  const response = await api.post(`${apiURL}/${collection}${draft ? '?draft=true' : ''}`, { data })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as { doc: { id: number } }).doc
}
async function createMedia(api: APIRequestContext, alt: string, filename: string): Promise<{ id: number }> {
  const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jz8AAAAASUVORK5CYII=', 'base64')
  const response = await api.post(`${apiURL}/media`, { multipart: { _payload: JSON.stringify({ alt }), file: { name: filename, mimeType: 'image/png', buffer } } })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as { doc: { id: number } }).doc
}
const lexicalText = (text: string) => ({ root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [
  { type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', children: [{ type: 'text', text, format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] },
] } })

test.describe('Admin Panel', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    page = await context.newPage()

    await login({ page, user: testUser })
  })

  test('can navigate to dashboard', async () => {
    await page.goto('http://localhost:3000/admin')
    await expect(page).toHaveURL('http://localhost:3000/admin')
    const dashboardArtifact = page.locator('span[title="Dashboard"]').first()
    await expect(dashboardArtifact).toBeVisible()
  })

  test('defaults the Admin navigation to Content open with larger group labels', async () => {
    await page.goto('http://localhost:3000/admin').catch((error: Error) => {
      if (!error.message.includes('ERR_ABORTED')) throw error
    })
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('[data-admin-nav-defaults]')).toBeAttached()
    const content = page.getByRole('button', { name: 'Content', exact: true })
    await expect(content).toHaveClass(/nav-group__toggle--open/)
    for (const label of ['Design', 'Site', 'Admin']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveClass(/nav-group__toggle--collapsed/)
    }
    const sizes = await page.evaluate(() => ({
      group: Number.parseFloat(getComputedStyle(document.querySelector('.nav-group__label')!).fontSize),
      child: Number.parseFloat(getComputedStyle(document.querySelector('.nav__link-label')!).fontSize),
    }))
    expect(sizes.group).toBeGreaterThan(sizes.child)
  })

  test('can navigate to list view', async () => {
    await page.goto('http://localhost:3000/admin/collections/users')
    await expect(page).toHaveURL('http://localhost:3000/admin/collections/users')
    const listViewArtifact = page.locator('h1', { hasText: 'Users' }).first()
    await expect(listViewArtifact).toBeVisible()
  })

  test('can navigate to edit view', async () => {
    await page.goto('http://localhost:3000/admin/collections/users/create')
    await expect(page).toHaveURL(/\/admin\/collections\/users\/[a-zA-Z0-9-_]+/)
    const editViewArtifact = page.locator('input[name="email"]')
    await expect(editViewArtifact).toBeVisible()
  })

  test('shows Block Creator and Templates under Design', async () => {
    await page.goto('http://localhost:3000/admin')
    await expect(page.getByText('Design', { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Design', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Block Creator', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Templates', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Design Variants', exact: true })).toHaveCount(0)
    await page.goto('http://localhost:3000/admin/collections/design-block-types')
    await expect(page.getByRole('heading', { name: 'Block Creator' })).toBeVisible()
    await page.goto('http://localhost:3000/admin/collections/design-templates')
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible()
  })

  test('opens Standard Article with legacy references preserved in the visual builder', async () => {
    const api = page.context().request
    const types = await (await api.get(`${apiURL}/design-block-types?where[slug][equals]=hero-board&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const designs = await (await api.get(`${apiURL}/design-block-designs?where[slug][equals]=hero-board-feature&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const result = await api.post(`${apiURL}/design-templates`, { data: { name: 'Standard Article', slug: `standard-article-browser-${Date.now()}`, status: 'published', _status: 'published', allowedCollections: ['posts'], sections: [{ key: 'hero', name: 'Hero', blockType: types.docs[0].id, blockDesign: designs.docs[0].id }] } })
    expect(result.ok(), await result.text()).toBe(true)
    const templateID = (await result.json() as { doc: { id: number } }).doc.id
    try {
      await page.goto(`http://localhost:3000/admin/collections/design-templates/${templateID}`)
      const builder = page.getByTestId('template-builder')
      await expect(builder.getByRole('heading', { name: 'Standard Article' })).toBeVisible()
      await expect(builder.getByRole('heading', { name: 'Blocks' })).toBeVisible()
      await expect(builder.getByRole('heading', { name: 'Template Canvas' })).toBeVisible()
      await expect(builder.getByRole('heading', { name: 'Existing Designed Blocks' })).toBeVisible()
      await expect(builder.getByText('Hero', { exact: true })).toBeVisible()
      await expect(page.locator('input[name="slug"]')).toBeHidden()
    } finally { await api.delete(`${apiURL}/design-templates/${templateID}`) }
  })

  test('builds a Newsletter with drag and drop, stable fields, Hero mappings, and nested columns', async () => {
    test.setTimeout(240_000)
    const api = page.context().request
    const suffix = Date.now().toString(36)
    const name = `Newsletter ${suffix}`
    let templateID: number | undefined
    let postID: number | undefined
    let mediaID: number | undefined
    try {
      await page.goto('http://localhost:3000/admin/collections/design-templates/create')
      const builder = page.getByTestId('template-builder')
      await builder.getByRole('tab', { name: 'Template Properties' }).click()
      await builder.getByRole('textbox', { name: 'Name' }).fill(name)
      await builder.getByRole('checkbox', { name: 'Posts' }).check()
      const createdResponse = page.waitForResponse((response) => response.url().includes('/api/design-templates') && response.request().method() === 'POST')
      await builder.getByRole('button', { name: 'Save Draft' }).click()
      const created = await createdResponse
      templateID = (await created.json() as { doc: { id: number } }).doc.id
      await expect(page).toHaveURL(new RegExp(`/design-templates/${templateID}`))
      await builder.getByRole('tab', { name: /Custom Fields/ }).click()
      await builder.getByRole('button', { name: 'Add your first field' }).click()
      await builder.getByRole('textbox', { name: 'Field Label 1' }).fill('Newsletter Introduction')
      await builder.getByRole('combobox', { name: 'Field Type 1' }).selectOption('shortText')
      await builder.getByRole('tab', { name: 'Canvas' }).click()

      await builder.getByRole('button', { name: 'Hero Board', exact: true }).click()
      await expect(builder.getByRole('complementary', { name: 'Configure panel' }).getByRole('heading', { name: 'Configure Hero Board' })).toBeVisible()
      await builder.getByRole('combobox', { name: 'Design' }).selectOption({ label: 'Hero Board - Feature' })
      for (const [slot, label, required] of [['Headline', 'Issue Title', true], ['Subheadline', 'Issue Subtitle', false], ['Background Image', 'Hero Image', false]] as const) {
        const row = builder.getByText(slot, { exact: true }).locator('..')
        await row.getByRole('button', { name: 'Add / Map Field' }).click()
        await row.getByRole('textbox', { name: `${slot} Field Label` }).fill(label)
        if (required) await row.getByRole('checkbox', { name: 'Required' }).check()
      }
      await builder.getByRole('button', { name: 'Save Element' }).click()

      await builder.getByRole('button', { name: 'Columns', exact: true }).click()
      await expect(builder.getByRole('radiogroup', { name: 'Column Layout' })).toBeVisible({ timeout: 10_000 })
      await builder.getByRole('radio', { name: '60/40' }).click()
      await builder.getByRole('button', { name: 'Save Element' }).click()
      const left = builder.getByLabel('Column 1', { exact: true })
      const right = builder.getByLabel('Column 2', { exact: true })
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await builder.getByRole('button', { name: 'Drag Rich Text' }).dispatchEvent('dragstart', { dataTransfer: transfer })
      await left.dispatchEvent('dragover', { dataTransfer: transfer })
      await left.dispatchEvent('drop', { dataTransfer: transfer })
      await expect(builder.getByRole('textbox', { name: 'Block Label' })).toBeVisible({ timeout: 10_000 })
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Main Story')
      await builder.getByRole('checkbox', { name: 'Required' }).check()
      await builder.getByRole('tab', { name: 'Style' }).click()
      await builder.getByRole('combobox', { name: 'Font size' }).selectOption('large')
      await builder.getByRole('combobox', { name: 'Width' }).selectOption('wide')
      await builder.getByRole('tab', { name: 'Advanced' }).click()
      await builder.getByRole('textbox', { name: 'HTML Anchor' }).fill('main-story')
      await builder.getByRole('button', { name: 'Save Element' }).click()
      await right.getByRole('button', { name: 'Add element to Column 2' }).click()
      const elementPicker = page.getByRole('dialog', { name: 'Add an element' })
      await expect(elementPicker).toBeVisible()
      await expect(elementPicker.getByRole('searchbox', { name: 'Search elements' })).toBeVisible()
      await elementPicker.getByRole('tab', { name: 'Media' }).click()
      await expect(elementPicker.getByRole('button', { name: /^Image/ })).toBeVisible()
      await expect(elementPicker.getByRole('button', { name: /^Paragraph/ })).toBeHidden()
      await elementPicker.getByRole('button', { name: /^Image/ }).click()
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Story Image')
      await builder.getByRole('button', { name: 'Save Element' }).click()
      const columnsCard = builder.locator('article').filter({ hasText: 'Columns' }).first()
      await columnsCard.getByRole('button', { name: /Columns ·/ }).click()
      await columnsCard.getByRole('button', { name: 'Edit columns' }).click()
      await builder.getByRole('radio', { name: '50/50' }).click()
      await builder.getByRole('button', { name: 'Save Element' }).click()
      await expect(columnsCard.getByRole('button', { name: 'Main Story' })).toBeVisible()
      await expect(columnsCard.getByRole('button', { name: 'Story Image' })).toBeVisible()
      const libraryToggle = builder.locator('[aria-controls="template-element-library"]')
      const openCanvasWidth = (await builder.getByRole('main', { name: 'Template Canvas' }).boundingBox())!.width
      await libraryToggle.click()
      await expect(builder.getByRole('heading', { name: 'Blocks' })).toBeHidden()
      const closedCanvasWidth = (await builder.getByRole('main', { name: 'Template Canvas' }).boundingBox())!.width
      expect(closedCanvasWidth).toBeGreaterThan(openCanvasWidth)
      await builder.getByRole('button', { name: 'Show editor sidebar' }).click()
      await expect(builder.getByRole('heading', { name: 'Blocks' })).toBeVisible()
      await builder.getByRole('tab', { name: 'List View' }).click()
      await expect(builder.getByRole('tree', { name: 'Template block list' })).toContainText('Main Story')
      await builder.getByRole('tab', { name: 'Blocks' }).click()
      await builder.getByRole('button', { name: 'Rich Text', exact: true }).click()
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Closing Message')
      await builder.getByRole('button', { name: 'Save Element' }).click()
      await builder.getByRole('button', { name: 'Gallery', exact: true }).click()
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Issue Photos')
      await builder.getByRole('button', { name: 'Save Element' }).click()
      await builder.getByRole('button', { name: 'Image', exact: true }).click()
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Post Featured Image')
      await builder.getByRole('combobox', { name: 'Content Source' }).selectOption('document')
      await expect(builder.getByRole('combobox', { name: 'Document Field' }).locator('option')).toHaveText(['Featured Image'])
      await builder.getByRole('combobox', { name: 'Document Field' }).selectOption('featuredImage')
      await expect(builder.getByRole('textbox', { name: 'Preview Text' })).toHaveCount(0)
      await builder.getByRole('button', { name: 'Save Element' }).click()
      await builder.getByRole('button', { name: 'Heading / Short Text', exact: true }).click()
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Bound Post Title')
      await builder.getByRole('combobox', { name: 'Content Source' }).selectOption('document')
      await builder.getByRole('combobox', { name: 'Document Field' }).selectOption('title')
      await builder.getByRole('textbox', { name: 'Preview Text' }).fill('Sample Post Title')
      await builder.getByRole('button', { name: 'Save Element' }).click()
      await builder.getByRole('button', { name: 'Heading / Short Text', exact: true }).click()
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Inline Heading')
      await builder.getByRole('combobox', { name: 'Content Source' }).selectOption('static')
      await builder.getByRole('textbox', { name: 'Static Text' }).fill('Initial heading')
      await builder.getByRole('button', { name: 'Save Element' }).click()
      await builder.getByRole('button', { name: 'Heading / Short Text', exact: true }).click()
      await builder.getByRole('textbox', { name: 'Block Label' }).fill('Introduction Heading')
      await builder.getByRole('combobox', { name: 'Content Source' }).selectOption('customField')
      await builder.getByRole('combobox', { name: 'Custom Field' }).selectOption({ label: 'Newsletter Introduction' })
      await builder.getByRole('textbox', { name: 'Placeholder' }).fill('Introduction preview')
      await builder.getByRole('button', { name: 'Save Element' }).click()
      const inlineHeading = builder.getByRole('button', { name: 'Inline Heading' }).locator('[contenteditable="true"]')
      await inlineHeading.fill('Updated directly on canvas')
      await inlineHeading.blur()

      const draftResponse = page.waitForResponse((response) => response.url().includes(`/api/design-templates/${templateID}`) && response.request().method() === 'PATCH')
      await builder.getByRole('button', { name: 'Save Draft' }).click()
      expect((await draftResponse).ok()).toBe(true)
      const draft = await (await api.get(`${apiURL}/design-templates/${templateID}?draft=true&depth=0`)).json() as { layout: Array<Record<string, unknown>>; customFields: Array<{ id: string; label: string }>; _status: string }
      expect(draft._status).toBe('draft')
      expect(JSON.stringify(draft.layout)).toContain('Issue Title')
      expect(JSON.stringify(draft.layout)).toContain('Main Story')
      expect(JSON.stringify(draft.layout)).toContain('"field":"featuredImage"')
      expect(JSON.stringify(draft.layout)).toContain('"width":50')
      expect(JSON.stringify(draft.layout)).toContain('"fontSize":"large"')
      expect(JSON.stringify(draft.layout)).toContain('"anchor":"main-story"')
      expect(JSON.stringify(draft.layout)).toContain('Updated directly on canvas')
      const mainStoryID = (JSON.stringify(draft.layout).match(/"id":"(field_[^"]+)","type":"field","fieldType":"richText","label":"Main Story"/) ?? [])[1]
      expect(mainStoryID).toBeTruthy()

      const publishResponse = page.waitForResponse((response) => response.url().includes(`/api/design-templates/${templateID}`) && response.request().method() === 'PATCH')
      await builder.getByRole('button', { name: 'Publish Template' }).click()
      expect((await publishResponse).ok()).toBe(true)
      await page.goto('http://localhost:3000/admin/collections/posts/create')
      await expect(page.getByRole('button', { name: 'Template', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Content', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Featured Image', exact: true })).toBeVisible()
      const tabLabels = await page.locator('.tabs-field__tabs button').allTextContents()
      expect(tabLabels).toEqual(['Template', 'Content', 'Featured Image', 'Organization', 'Publishing', 'SEO'])
      const templateSelect = page.locator('#field-designTemplate [role="combobox"]')
      await templateSelect.fill(name)
      await page.getByRole('option', { name }).click()
      await expect(page.locator('.tabs-field__tabs').getByRole('button', { name: 'Content', exact: true })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Issue Title *' })).toBeVisible()
      const titleBox = (await page.getByRole('textbox', { name: 'Title *', exact: true }).boundingBox())!
      const slugBox = (await page.getByRole('textbox', { name: 'Slug *', exact: true }).boundingBox())!
      const issueTitleBox = (await page.getByRole('textbox', { name: 'Issue Title *', exact: true }).boundingBox())!
      const excerptBox = (await page.getByRole('textbox', { name: 'Excerpt', exact: true }).boundingBox())!
      expect(titleBox.y).toBeLessThan(slugBox.y)
      expect(slugBox.y).toBeLessThan(issueTitleBox.y)
      expect(issueTitleBox.y).toBeLessThan(excerptBox.y)
      expect(issueTitleBox.width).toBeGreaterThanOrEqual(titleBox.width * 0.95)
      await expect(page.locator('.rich-text-lexical').filter({ hasText: 'Main Story' }).getByRole('textbox')).toBeVisible()
      await expect(page.getByText('Hero Image')).toBeVisible()
      await expect(page.locator('.rich-text-lexical').filter({ hasText: 'Closing Message' }).getByRole('textbox')).toBeVisible()
      await expect(page.locator('.upload').filter({ hasText: 'Issue Photos' }).getByRole('button', { name: 'Choose from existing' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Newsletter Introduction' })).toBeVisible()

      const users = await (await api.get(`${apiURL}/users?limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
      const media = await createMedia(api, 'Newsletter test image', `newsletter-${suffix}.png`)
      mediaID = media.id
      const allFields: Array<{ id: string; label: string }> = []
      const walk = (items: Array<Record<string, unknown>>) => items.forEach((item) => {
        if (item.type === 'field') allFields.push(item as { id: string; label: string })
        if (item.type === 'block' && Array.isArray(item.fields)) allFields.push(...item.fields as Array<{ id: string; label: string }>)
        if (Array.isArray(item.children)) walk(item.children as Array<Record<string, unknown>>)
        if (Array.isArray(item.columns)) for (const column of item.columns as Array<{ children: Array<Record<string, unknown>> }>) walk(column.children)
      })
      walk(draft.layout)
      const fieldID = (label: string) => allFields.find((field) => field.label === label)?.id as string
      const content = { root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [
        { type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', children: [{ type: 'text', text: 'Newsletter body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] },
      ] } }
      const postResponse = await api.post(`${apiURL}/posts`, { data: { title: `Newsletter Proof ${suffix}`, slug: `newsletter-proof-${suffix}`, author: users.docs[0].id, featuredImage: media.id, content,
        designTemplate: templateID, templateValues: { [fieldID('Issue Title')]: 'November 2026', [fieldID('Issue Subtitle')]: 'Monthly Newsletter', [fieldID('Hero Image')]: media.id,
          [fieldID('Main Story')]: lexicalText('test rich text'), [fieldID('Story Image')]: media.id, [fieldID('Closing Message')]: lexicalText('test closing text'), [fieldID('Issue Photos')]: [media.id],
          [draft.customFields[0].id]: 'Custom field heading' }, _status: 'published' } })
      expect(postResponse.ok(), await postResponse.text()).toBe(true)
      postID = (await postResponse.json() as { doc: { id: number } }).doc.id
      await page.goto(`http://localhost:3000/posts/newsletter-proof-${suffix}`)
      await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible()
      await expect(page.locator('.template-field--shortText').filter({ hasText: `Newsletter Proof ${suffix}` })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Updated directly on canvas' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Custom field heading' })).toBeVisible()
      const templateImages = page.locator('img.template-field--image[alt="Newsletter test image"]')
      await expect(templateImages).toHaveCount(2)
      await expect(templateImages.last()).toBeVisible()
      await expect(page.getByText('test rich text')).toBeVisible()
      await expect(page.getByText('test closing text')).toBeVisible()
    } finally {
      if (postID) await api.delete(`${apiURL}/posts/${postID}`)
      if (mediaID) await api.delete(`${apiURL}/media/${mediaID}`)
      if (templateID) await api.delete(`${apiURL}/design-templates/${templateID}`)
    }
  })

  test('repeatedly saves and live-previews modern Newsletter Lexical and mapped fields', async () => {
    test.setTimeout(180_000)
    const api = page.context().request
    const suffix = Date.now().toString(36)
    const users = await (await api.get(`${apiURL}/users?limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const types = await (await api.get(`${apiURL}/design-block-types?where[slug][equals]=hero-board&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const designs = await (await api.get(`${apiURL}/design-block-designs?where[slug][equals]=hero-board-feature&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const ids = { title: `field_title_${suffix}`, subtitle: `field_subtitle_${suffix}`, hero: `field_hero_${suffix}`, story: `field_story_${suffix}`, gallery: `field_gallery_${suffix}` }
    let templateID: number | undefined
    let postID: number | undefined
    let mediaAID: number | undefined
    let mediaBID: number | undefined
    try {
      const templateResponse = await api.post(`${apiURL}/design-templates`, { data: { name: `Live Newsletter ${suffix}`, slug: `live-newsletter-${suffix}`, status: 'published', _status: 'published', allowedCollections: ['posts'], sections: [], layout: [
        { id: `hero_${suffix}`, type: 'block', name: 'Hero Board', blockType: types.docs[0].id, blockDesign: designs.docs[0].id, fields: [
          { id: ids.title, type: 'field', fieldType: 'shortText', label: 'Issue Title', required: true },
          { id: ids.subtitle, type: 'field', fieldType: 'shortText', label: 'Issue Subtitle' },
          { id: ids.hero, type: 'field', fieldType: 'image', label: 'Hero Image' },
        ], slotMappings: { headline: ids.title, subheadline: ids.subtitle, backgroundImage: ids.hero } },
        { id: `columns_${suffix}`, type: 'layout', layout: 'columns', columns: [
          { id: `left_${suffix}`, width: 60, children: [{ id: ids.story, type: 'field', fieldType: 'richText', label: 'Main Story', required: true }] },
          { id: `right_${suffix}`, width: 40, children: [] },
        ] }, { id: ids.gallery, type: 'field', fieldType: 'images', label: 'Issue Photos' },
      ] } })
      expect(templateResponse.ok(), await templateResponse.text()).toBe(true)
      templateID = (await templateResponse.json() as { doc: { id: number } }).doc.id
      const mediaA = await createMedia(api, 'Newsletter image A', `newsletter-a-${suffix}.png`)
      const mediaB = await createMedia(api, 'Newsletter image B', `newsletter-b-${suffix}.png`)
      mediaAID = mediaA.id
      mediaBID = mediaB.id
      const postResponse = await api.post(`${apiURL}/posts`, { data: { title: `Live Newsletter Proof ${suffix}`, slug: `live-newsletter-proof-${suffix}`, author: users.docs[0].id,
        content: lexicalText('Post body'), designTemplate: templateID, templateValues: { [ids.title]: 'November 2026', [ids.subtitle]: 'Monthly Newsletter', [ids.hero]: mediaA.id, [ids.story]: lexicalText('Version Zero'), [ids.gallery]: [mediaA.id, mediaB.id] }, _status: 'published' } })
      expect(postResponse.ok(), await postResponse.text()).toBe(true)
      postID = (await postResponse.json() as { doc: { id: number } }).doc.id

      await page.goto(`http://localhost:3000/admin/collections/posts/${postID}`)
      const title = page.getByRole('textbox', { name: 'Issue Title *' })
      const story = page.locator('.rich-text-lexical').filter({ hasText: 'Main Story' }).getByRole('textbox')
      await expect(story).toContainText('Version Zero')
      await story.click()
      await story.press('Control+A')
      await story.pressSequentially('Version One')
      await expect(story).toContainText('Version One')
      await page.waitForTimeout(750)
      await expect(page.getByRole('button', { name: 'Save Draft' })).toBeEnabled()
      let save = page.waitForResponse((response) => response.url().includes(`/api/posts/${postID}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      expect((await save).ok()).toBe(true)
      await story.click()
      await story.press('Control+A')
      await story.pressSequentially('Version Two')
      await expect(story).toContainText('Version Two')
      await page.waitForTimeout(750)
      await expect(page.getByRole('button', { name: 'Save Draft' })).toBeEnabled()
      save = page.waitForResponse((response) => response.url().includes(`/api/posts/${postID}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      expect((await save).ok()).toBe(true)
      const stored = await (await api.get(`${apiURL}/posts/${postID}?draft=true&depth=0`)).json() as { templateValues: Record<string, unknown> }
      expect(JSON.stringify(stored.templateValues[ids.story])).toContain('Version Two')
      expect(stored.templateValues[ids.story]).toMatchObject({ root: { type: 'root' } })

      await page.getByRole('button', { name: 'Live Preview' }).click()
      const preview = page.frameLocator('iframe')
      await expect(preview.getByRole('heading', { name: 'November 2026' })).toBeVisible()
      await title.fill('December 2026')
      await expect(preview.getByRole('heading', { name: 'December 2026' })).toBeVisible()
      await title.fill('January 2027')
      await expect(preview.getByRole('heading', { name: 'January 2027' })).toBeVisible()
      await story.click()
      await story.press('Control+A')
      await story.pressSequentially('Live Lexical Story')
      await expect(preview.getByText('Live Lexical Story')).toBeVisible()
      const heroUpload = page.locator('.upload').filter({ hasText: 'Hero Image' })
      await heroUpload.getByRole('button').last().click()
      await heroUpload.getByRole('button', { name: 'Choose from existing' }).click()
      await page.getByRole('row', { name: new RegExp(`newsletter-b-${suffix}\\.png`) }).getByRole('button').click()
      await expect(preview.getByRole('img', { name: 'Newsletter image B' })).toBeVisible()
      await page.waitForTimeout(500)
      save = page.waitForResponse((response) => response.url().includes(`/api/posts/${postID}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      expect((await save).ok()).toBe(true)
      let mediaStored = await (await api.get(`${apiURL}/posts/${postID}?draft=true&depth=0`)).json() as { templateValues: Record<string, unknown> }
      expect(String(mediaStored.templateValues[ids.hero])).toBe(String(mediaB.id))

      const gallery = page.locator('.field-type.upload').filter({ hasText: 'Issue Photos' })
      const galleryFiles = gallery.getByRole('link', { name: new RegExp(`newsletter-[ab]-${suffix}\\.png`) })
      await expect(galleryFiles).toHaveCount(2)
      await galleryFiles.last().locator('../../../..').getByRole('button').last().click()
      await expect(galleryFiles).toHaveCount(1)
      save = page.waitForResponse((response) => response.url().includes(`/api/posts/${postID}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      expect((await save).ok()).toBe(true)
      mediaStored = await (await api.get(`${apiURL}/posts/${postID}?draft=true&depth=0`)).json() as { templateValues: Record<string, unknown> }
      expect(mediaStored.templateValues[ids.gallery]).toHaveLength(1)
    } finally {
      if (postID) await api.delete(`${apiURL}/posts/${postID}`)
      if (mediaAID) await api.delete(`${apiURL}/media/${mediaAID}`)
      if (mediaBID) await api.delete(`${apiURL}/media/${mediaBID}`)
      if (templateID) await api.delete(`${apiURL}/design-templates/${templateID}`)
    }
  })
  test('edits Template Hero values on a Post', async () => {
    test.setTimeout(150_000)
    const api = page.context().request
    const docs = async (collection: string, slug: string) => (await (await api.get(`http://localhost:3000/api/${collection}?where[slug][equals]=${slug}&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }).docs
    const users = await (await api.get(`http://localhost:3000/api/users?where[email][equals]=${encodeURIComponent(testUser.email)}&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const user = users.docs[0]
    const hero = (await docs('design-block-types', 'hero-board'))[0]
    const feature = (await docs('design-block-designs', 'hero-board-feature'))[0]
    const centered = (await docs('design-block-designs', 'hero-board-centered'))[0]
    const suffix = Date.now().toString(36)
    const templateResponse = await api.post('http://localhost:3000/api/design-templates', { data: { name: 'Browser Article', slug: `browser-article-${suffix}`,
      status: 'published', _status: 'published', allowedCollections: ['posts'],
      sections: [{ key: 'hero', name: 'Hero', blockType: hero.id, blockDesign: feature.id, required: true, allowDesignOverride: true }] } })
    expect(templateResponse.ok(), await templateResponse.text()).toBe(true)
    const template = (await templateResponse.json() as { doc: { id: number } }).doc
    const content = { root: { type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
      children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
        children: [{ type: 'text', text: 'Body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }] } }
    const postResponse = await api.post('http://localhost:3000/api/posts', { data: { title: 'Template Browser Post', slug: `template-browser-${suffix}`,
      author: user.id, content, designTemplate: template.id, templateValues: { hero: { headline: 'Initial Hero' } }, _status: 'published' } })
    expect(postResponse.ok(), await postResponse.text()).toBe(true)
    const post = (await postResponse.json() as { doc: { id: number } }).doc
    const media = await createMedia(api, 'Repeated save background', `repeated-save-${suffix}.png`)
    let alternateTemplateID: number | undefined
    try {
      await page.goto(`http://localhost:3000/admin/collections/posts/${post.id}`)
      await expect(page.getByRole('heading', { name: 'Template content' })).toBeVisible()
      const headline = page.getByRole('textbox', { name: 'Headline *' })
      await expect(headline).toHaveValue('Initial Hero')
      await headline.fill('Edited Hero')
      const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/posts/${post.id}`) && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      const response = await responsePromise
      expect(response.ok(), await response.text()).toBe(true)
      expect((await response.json() as { doc: { templateValues: unknown } }).doc.templateValues).toMatchObject({ hero: { headline: 'Edited Hero' } })
      expect((await (await api.get(`${apiURL}/posts/${post.id}?draft=true&depth=0`)).json() as { templateValues: { hero: { headline: string } } }).templateValues.hero.headline).toBe('Edited Hero')
      await expect(page.getByText('Draft saved successfully.').last()).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Template content' })).toBeVisible()
      await headline.fill('Second Hero')
      await page.getByRole('combobox', { name: 'Design' }).selectOption(String(centered.id))
      await expect(page.getByRole('combobox', { name: 'Design' })).toHaveValue(String(centered.id))
      const overrideResponsePromise = page.waitForResponse((next) => next.url().includes(`/api/posts/${post.id}`) && next.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      const overrideResponse = await overrideResponsePromise
      expect(overrideResponse.ok(), await overrideResponse.text()).toBe(true)
      const secondDoc = (await overrideResponse.json() as { doc: { designOverrides: unknown; templateValues: unknown } }).doc
      expect(secondDoc.designOverrides).toMatchObject({ hero: String(centered.id) })
      expect(secondDoc.templateValues).toMatchObject({ hero: { headline: 'Second Hero' } })
      const storedSecond = await (await api.get(`${apiURL}/posts/${post.id}?draft=true&depth=0`)).json() as { templateValues: { hero: { headline: string } }; designOverrides: Record<string, unknown> }
      expect(storedSecond.templateValues.hero.headline).toBe('Second Hero')
      expect(storedSecond.designOverrides.hero).toBe(String(centered.id))
      await page.getByRole('button', { name: 'Live Preview' }).click()
      await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Second Hero' })).toBeVisible()
      await expect(page.frameLocator('iframe').locator('.hero-board--align-center')).toBeVisible()
      await headline.fill('Preview interim')
      await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Preview interim' })).toBeVisible()
      await headline.fill('Version Three')
      await page.getByRole('textbox', { name: 'Eyebrow' }).fill('Before clearing')
      await page.getByRole('textbox', { name: 'Subheadline' }).fill('Updated subheadline')
      await page.getByRole('combobox', { name: 'Background Image' }).selectOption(String(media.id))
      await page.getByRole('textbox', { name: 'Primary CTA Label URL' }).fill('Read more')
      await page.getByRole('textbox', { name: 'URL', exact: true }).first().fill('/posts')
      await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Version Three' })).toBeVisible()
      const thirdResponsePromise = page.waitForResponse((next) => next.url().includes(`/api/posts/${post.id}`) && next.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      expect((await thirdResponsePromise).ok()).toBe(true)
      const storedThird = await (await api.get(`http://localhost:3000/api/posts/${post.id}?draft=true&depth=0`)).json() as { templateValues: { hero: Record<string, unknown> } }
      expect(storedThird.templateValues.hero).toMatchObject({ headline: 'Version Three', eyebrow: 'Before clearing', subheadline: 'Updated subheadline', backgroundImage: String(media.id), primaryCTA: { label: 'Read more', url: '/posts' } })
      await page.getByRole('textbox', { name: 'Eyebrow' }).fill('')
      await page.getByRole('combobox', { name: 'Design' }).selectOption('')
      const fourthResponsePromise = page.waitForResponse((next) => next.url().includes(`/api/posts/${post.id}`) && next.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      expect((await fourthResponsePromise).ok()).toBe(true)
      const storedFourth = await (await api.get(`http://localhost:3000/api/posts/${post.id}?draft=true&depth=0`)).json() as { templateValues: { hero: Record<string, unknown> }; designOverrides: Record<string, unknown> }
      expect(storedFourth.templateValues.hero).toMatchObject({ headline: 'Version Three', eyebrow: '', subheadline: 'Updated subheadline' })
      expect(storedFourth.designOverrides.hero).toBeNull()
      const alternateResponse = await api.post('http://localhost:3000/api/design-templates', { data: { name: 'Alternate Browser Article', slug: `alternate-browser-${suffix}`,
        status: 'published', _status: 'published', allowedCollections: ['posts'],
        sections: [{ key: 'alternateHero', name: 'Alternate Hero', blockType: hero.id, blockDesign: feature.id, required: false, allowDesignOverride: true }] } })
      expect(alternateResponse.ok(), await alternateResponse.text()).toBe(true)
      alternateTemplateID = (await alternateResponse.json() as { doc: { id: number } }).doc.id
      const templateSelect = page.locator('#field-designTemplate [role="combobox"]')
      await templateSelect.fill('Alternate Browser Article')
      await page.getByRole('option', { name: 'Alternate Browser Article' }).click()
      await expect(page.getByRole('group', { name: 'Alternate Hero' })).toBeVisible()
      const switchResponsePromise = page.waitForResponse((next) => next.url().includes(`/api/posts/${post.id}`) && next.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      expect((await switchResponsePromise).ok()).toBe(true)
      const switched = await (await api.get(`http://localhost:3000/api/posts/${post.id}?draft=true&depth=0`)).json() as { designTemplate: number; templateValues: { hero: Record<string, unknown> } }
      expect(switched.designTemplate).toBe(alternateTemplateID)
      expect(switched.templateValues.hero.headline).toBe('Version Three')
    } finally {
      await api.delete(`http://localhost:3000/api/posts/${post.id}`)
      if (alternateTemplateID) await api.delete(`http://localhost:3000/api/design-templates/${alternateTemplateID}`)
      await api.delete(`http://localhost:3000/api/design-templates/${template.id}`)
      await api.delete(`${apiURL}/media/${media.id}`)
    }
  })

  test('previews and duplicates a Hero Board design in Block Creator', async () => {
    test.setTimeout(90_000)
    const request = page.context().request
    const suffix = Date.now().toString(36)
    const typeResponse = await request.post('http://localhost:3000/api/design-block-types', { data: {
      name: 'Hero Board', slug: `hero-board-browser-${suffix}`, rendererKey: 'hero-board', schemaVersion: 1,
      status: 'published', _status: 'published', fields: heroBoardFields,
    } })
    expect(typeResponse.ok(), await typeResponse.text()).toBe(true)
    const type = (await typeResponse.json() as { doc: { id: number } }).doc
    const designs: Array<{ id: number }> = []
    let copiedID: number | undefined
    try {
      for (const variant of heroBoardDesigns) {
        const response = await request.post('http://localhost:3000/api/design-block-designs', { data: {
          name: variant.name, slug: `${variant.slug}-${suffix}`, blockType: type.id,
          status: 'published', _status: 'published', design: variant.design,
        } })
        expect(response.ok(), await response.text()).toBe(true)
        designs.push((await response.json() as { doc: { id: number } }).doc)
      }
      await page.goto('http://localhost:3000/admin/collections/design-block-types')
      await expect(page.getByText('Hero Board', { exact: true }).first()).toBeVisible()
      await expect(page.getByRole('row', { name: /Hero Board/ }).getByText('4', { exact: true }).first()).toBeVisible()
      await page.goto(`http://localhost:3000/admin/collections/design-block-types/${type.id}`)
      await expect(page.getByText('Hero Board - Feature')).toBeVisible()
      await page.goto(`http://localhost:3000/admin/collections/design-block-designs/${designs[3].id}`)
      await expect(page.getByRole('heading', { name: 'Design Preview' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Example Hero Headline' })).toBeVisible()
      await page.getByLabel('Sample headline').fill('Temporary Preview Headline')
      await expect(page.getByRole('heading', { name: 'Temporary Preview Headline' })).toBeVisible()
      const duplicateResponse = page.waitForResponse((response) => response.url().includes('/api/design-block-designs') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Duplicate as draft' }).click()
      const response = await duplicateResponse
      expect(response.ok()).toBe(true)
      await expect(page.getByRole('heading', { name: 'Hero Board - Feature Copy' })).toBeVisible()
      await expect(page).toHaveURL(/\/admin\/collections\/design-block-designs\/\d+/)
      copiedID = Number(page.url().split('/').pop())
      const copy = await (await request.get(`http://localhost:3000/api/design-block-designs/${copiedID}?depth=0`)).json() as { name: string; _status: string; blockType: number; design: { imageTreatment?: string } }
      expect(copy.name).toBe('Hero Board - Feature Copy')
      expect(copy._status).toBe('draft')
      expect(copy.blockType).toBe(type.id)
      expect(copy.design?.imageTreatment).toBe('feature')
    } finally {
      if (copiedID) await request.delete(`http://localhost:3000/api/design-block-designs/${copiedID}`)
      for (const design of designs) await request.delete(`http://localhost:3000/api/design-block-designs/${design.id}`)
      await request.delete(`http://localhost:3000/api/design-block-types/${type.id}`)
    }
  })

  test('can open categories and tags', async () => {
    await page.goto('http://localhost:3000/admin/collections/categories')
    await expect(page).toHaveURL('http://localhost:3000/admin/collections/categories')
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible()

    await page.goto('http://localhost:3000/admin/collections/tags')
    await expect(page).toHaveURL('http://localhost:3000/admin/collections/tags')
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible()
  })

  test('can open navigation and site settings', async () => {
    await page.goto('http://localhost:3000/admin/globals/navigation')
    await expect(page).toHaveURL('http://localhost:3000/admin/globals/navigation')
    await expect(page.getByText('Primary navigation')).toBeVisible()

    await page.goto('http://localhost:3000/admin/globals/site-settings')
    await expect(page).toHaveURL('http://localhost:3000/admin/globals/site-settings')
    await expect(page.getByText('Site Name')).toBeVisible()
  })

  test('shows the existing SEO plugin in its own Post and Page tab', async () => {
    for (const collection of ['posts', 'pages']) {
      await page.goto(`http://localhost:3000/admin/collections/${collection}/create`)
      await page.getByRole('textbox', { name: 'Title *' }).fill('SEO tab validation')
      for (const label of ['Content', 'Organization', 'Publishing', 'SEO']) {
        await expect(page.getByRole('button', { name: label, exact: true }).last()).toBeVisible()
      }
      await page.getByRole('button', { name: 'Content', exact: true }).last().click()
      await expect(page.locator('input[name="meta.title"]')).toHaveCount(0)
      await page.getByRole('button', { name: 'SEO', exact: true }).click()
      await expect(page.locator('input[name="meta.title"]')).toBeVisible()
      await expect(page.locator('textarea[name="meta.description"]')).toBeVisible()
      await expect(page.getByRole('button', { name: /generate/i }).first()).toBeVisible()
      await page.getByRole('button', { name: /generate/i }).first().click()
      await expect(page.locator('input[name="meta.title"]')).toHaveValue('SEO tab validation | Vorti')
    }
  })

  test('retains existing Post and Page SEO values in the edit form', async () => {
    const suffix = Date.now().toString(36)
    const api = page.context().request
    const users = await (await api.get(`${apiURL}/users?where[email][equals]=${encodeURIComponent(testUser.email)}&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const content = { root: { type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
      children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
        children: [{ type: 'text', text: 'Stored body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }],
    } }
    const post = await createDoc(api, 'posts', {
      title: 'SEO value Post', slug: `seo-value-post-${suffix}`, author: users.docs[0].id, content,
      meta: { title: 'Stored Post SEO Title', description: 'Stored Post SEO Description' },
    })
    const pageDoc = await createDoc(api, 'pages', {
      title: 'SEO value Page', slug: `seo-value-page-${suffix}`, content,
      meta: { title: 'Stored Page SEO Title', description: 'Stored Page SEO Description' },
    })
    try {
      for (const [collection, id, title, description] of [
        ['posts', post.id, 'Stored Post SEO Title', 'Stored Post SEO Description'],
        ['pages', pageDoc.id, 'Stored Page SEO Title', 'Stored Page SEO Description'],
      ] as const) {
        await page.goto(`http://localhost:3000/admin/collections/${collection}/${id}`)
        await expect(page.getByRole('textbox', { name: 'Title *' })).toBeVisible()
        await page.waitForLoadState('networkidle')
        await page.getByRole('button', { name: 'SEO', exact: true }).click()
        await expect(page.locator('input[name="meta.title"]')).toHaveValue(title)
        await expect(page.locator('textarea[name="meta.description"]')).toBeVisible()
        await expect(page.locator('textarea[name="meta.description"]')).toHaveValue(description)
      }
    } finally {
      await api.delete(`${apiURL}/posts/${post.id}`)
      await api.delete(`${apiURL}/pages/${pageDoc.id}`)
    }
  })

  test('offers native Live Preview for Posts and Pages', async ({ browser }) => {
    test.setTimeout(90_000)
    const start = Date.now()
    const mark = (phase: string) => console.info(`[Live Preview timing] ${phase}: ${Date.now() - start}ms`)
    const api = page.context().request
    const users = await (await api.get(`${apiURL}/users?where[email][equals]=${encodeURIComponent(testUser.email)}&limit=1&depth=0`)).json() as { docs: Array<{ id: number }> }
    const content = { root: { type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
      children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
        children: [{ type: 'text', text: 'Preview body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }],
    } }
    const post = await createDoc(api, 'posts', {
      title: 'Published Preview Post', slug: 'published-preview-post', author: users.docs[0].id,
      content, _status: 'published',
    })
    const pageDoc = await createDoc(api, 'pages', {
      title: 'Published Preview Page', slug: 'published-preview-page', content, _status: 'published',
    })
    const media = await createMedia(api, 'Live preview test image', 'live-preview-test.png')
    mark('setup: two published documents and media')
    try {
      for (const [collection, id, title, route] of [
        ['posts', post.id, 'Published Preview Post', '/posts/published-preview-post'],
        ['pages', pageDoc.id, 'Published Preview Page', '/published-preview-page'],
      ] as const) {
        mark(`start ${collection} iframe and edit checks`)
        await page.goto(`http://localhost:3000/admin/collections/${collection}/${id}`)
        await page.waitForLoadState('networkidle')
        await expect(page.getByRole('button', { name: 'Live Preview' })).toBeVisible()
        await page.getByRole('button', { name: 'Live Preview' }).click()
        await expect(page.locator('iframe')).toBeVisible()
        await expect(page.frameLocator('iframe').getByRole('heading', { name: title })).toBeVisible()
        await page.getByRole('textbox', { name: 'Title *' }).fill(`Edited ${title}`)
        await expect(page.frameLocator('iframe').getByRole('heading', { name: `Edited ${title}` })).toBeVisible()
        await page.locator('[contenteditable="true"]').first().fill('Edited live body')
        await expect(page.frameLocator('iframe').getByText('Edited live body')).toBeVisible()
        if (collection === 'posts') {
          await page.getByRole('button', { name: 'Choose from existing' }).click()
          await page.getByRole('row', { name: /live-preview-test.png/ }).getByRole('button').click()
          await expect(page.frameLocator('iframe').getByRole('img', { name: 'Live preview test image' })).toBeVisible()
        }
        const anonymous = await browser.newPage()
        try {
          await anonymous.goto(`http://localhost:3000${route}`)
          await expect(anonymous.getByRole('heading', { name: title })).toBeVisible()
          const iframeURL = await page.locator('iframe').getAttribute('src')
          if (iframeURL) expect((await anonymous.goto(new URL(iframeURL, 'http://localhost:3000').toString()))?.status()).toBe(404)
        } finally {
          await anonymous.close()
        }
        mark(`finished ${collection} iframe and anonymous checks`)
      }
      const unpublished = await createDoc(api, 'posts', {
        title: 'Unpublished Preview Post', slug: 'unpublished-preview-post', author: users.docs[0].id, content,
        _status: 'draft',
      }, true)
      try {
        await page.goto(`http://localhost:3000/admin/collections/posts/${unpublished.id}`)
        await page.waitForLoadState('networkidle')
        await page.getByRole('button', { name: 'Live Preview' }).click()
        await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Unpublished Preview Post' })).toBeVisible()
        const anonymous = await browser.newPage()
        try {
          expect((await anonymous.goto('http://localhost:3000/posts/unpublished-preview-post'))?.status()).toBe(404)
        } finally {
          await anonymous.close()
        }
      } finally {
        await api.delete(`${apiURL}/posts/${unpublished.id}`)
      }
      mark('finished draft Post checks')
      const unpublishedPage = await createDoc(api, 'pages', {
        title: 'Unpublished Preview Page', slug: 'unpublished-preview-page', content,
        _status: 'draft',
      }, true)
      try {
        await page.goto(`http://localhost:3000/admin/collections/pages/${unpublishedPage.id}`)
        await page.waitForLoadState('networkidle')
        await page.getByRole('button', { name: 'Live Preview' }).click()
        await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Unpublished Preview Page' })).toBeVisible()
        const anonymous = await browser.newPage()
        try {
          expect((await anonymous.goto('http://localhost:3000/unpublished-preview-page'))?.status()).toBe(404)
        } finally {
          await anonymous.close()
        }
      } finally {
        await api.delete(`${apiURL}/pages/${unpublishedPage.id}`)
      }
      mark('finished draft Page checks')
    } finally {
      await api.delete(`${apiURL}/posts/${post.id}`)
      await api.delete(`${apiURL}/pages/${pageDoc.id}`)
      await api.delete(`${apiURL}/media/${media.id}`)
    }
  })
})
