import { expect, test } from '@playwright/test'

test.use({ actionTimeout: 60000 })
const content = { root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [
  { type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', children: [{ type: 'text', text: 'SEO verification body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] },
] } }

for (const collection of ['posts', 'pages'] as const) {
  test(`${collection}: SEO inspector retains values through tabs, expansion, image selection and publication`, async ({ page }) => {
    expect((await page.request.post('/api/users/login', { data: { email: 'dev@payloadcms.com', password: 'test' }, timeout: 120000 })).ok()).toBe(true)
    const stamp = `${collection}-${Date.now()}`, title = `SEO ${stamp}`, slug = `seo-${stamp}`
    const image = await page.request.post('/api/media', { multipart: {
      _payload: JSON.stringify({ alt: `SEO image ${stamp}` }),
      file: { name: `seo-${stamp}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jz8AAAAASUVORK5CYII=', 'base64') },
    } })
    expect(image.ok(), await image.text()).toBe(true)
    const media = (await image.json()).doc
    const created = await page.request.post(`/api/${collection}?draft=true`, { data: {
      title, slug, content, _status: 'draft', excerpt: 'Generated description',
      contentLayout: { version: 1, nodes: [] }, meta: { title: 'Original SEO title', description: 'Original SEO description' },
    } })
    expect(created.ok(), await created.text()).toBe(true)
    const doc = (await created.json()).doc
    await page.goto(`/admin/collections/${collection}/${doc.id}`)
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
    await expect(inspector.getByRole('tab')).toHaveText(['Block', collection === 'posts' ? 'Post' : 'Page', 'SEO'])
    await expect(inspector.locator('input[name="meta.title"]')).toHaveCount(0)
    await inspector.getByRole('tab', { name: 'SEO', exact: true }).click()
    const seoTitle = page.locator('input[name="meta.title"]'), description = page.locator('textarea[name="meta.description"]')
    await expect(seoTitle).toHaveValue('Original SEO title')
    await expect(description).toHaveValue('Original SEO description')
    const generateTitle = inspector.getByRole('button', { name: 'Auto-generate', exact: true }).first()
    await generateTitle.click()
    await expect(seoTitle).toHaveValue(`${title} | Vorti`)
    await seoTitle.fill(`Custom SEO ${stamp}`)
    await description.fill(`Description ${stamp}`)
    await inspector.getByRole('tab', { name: 'Document settings' }).click()
    await inspector.getByRole('tab', { name: 'SEO', exact: true }).click()
    await expect(seoTitle).toHaveValue(`Custom SEO ${stamp}`)
    await inspector.getByRole('button', { name: 'Expand inspector' }).click()
    const dialog = page.getByRole('dialog', { name: 'SEO settings', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('input[name="meta.title"]')).toHaveValue(`Custom SEO ${stamp}`)
    await dialog.getByRole('button', { name: 'Choose from existing' }).click()
    await page.getByRole('row', { name: new RegExp(`seo-${stamp}\\.png`) }).getByRole('button').click()
    await expect(dialog.getByText(`seo-${stamp}.png`, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(inspector.getByRole('tab', { name: 'SEO', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(description).toHaveValue(`Description ${stamp}`)
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
    await expect.poll(async () => (await (await page.request.get(`/api/${collection}/${doc.id}?draft=true&depth=0`)).json()).meta).toMatchObject({ title: `Custom SEO ${stamp}`, description: `Description ${stamp}`, image: media.id })
    await page.reload()
    await inspector.getByRole('tab', { name: 'SEO', exact: true }).click()
    await expect(seoTitle).toHaveValue(`Custom SEO ${stamp}`)
    await expect(description).toHaveValue(`Description ${stamp}`)
    await page.getByRole('button', { name: 'Publish changes', exact: true }).click()
    await expect.poll(async () => (await (await page.request.get(`/api/${collection}/${doc.id}?depth=0`)).json())._status).toBe('published')
    const publicHTML = await (await page.request.get(collection === 'posts' ? `/posts/${slug}` : `/${slug}`)).text()
    expect(publicHTML).toContain(`Custom SEO ${stamp}`)
    expect(publicHTML).toContain(`Description ${stamp}`)
    expect(publicHTML).toContain('og:image')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click()
    await expect(inspector.getByRole('tab', { name: 'SEO', exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: 'Expand inspector' }).click()
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: `.wrangler/seo-${collection}-mobile.png` })
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  })
}

test('legacy Standard Article stays editable while new selections exclude it', async ({ page }) => {
  expect((await page.request.post('/api/users/login', { data: { email: 'dev@payloadcms.com', password: 'test' }, timeout: 120000 })).ok()).toBe(true)
  const seed = await (await page.request.get('/api/design-templates?where[slug][equals]=standard-article&depth=0')).json()
  expect(seed.docs).toHaveLength(1)
  const created = await page.request.post('/api/posts?draft=true', { data: { title: `Legacy article ${Date.now()}`, content, designTemplate: seed.docs[0].id, _status: 'draft' } })
  expect(created.ok(), await created.text()).toBe(true)
  const post = (await created.json()).doc
  await page.goto(`/admin/collections/posts/${post.id}`)
  await expect(page.getByRole('combobox', { name: 'Template', exact: true })).toHaveValue(String(seed.docs[0].id))
  await expect(page.getByRole('combobox', { name: 'Template', exact: true })).toContainText('Standard Article')
  await page.locator('.doc-header input[name=title]').fill('Retained legacy article')
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get(`/api/posts/${post.id}?draft=true&depth=0`)).json()).title).toBe('Retained legacy article')
  await page.goto('/admin/collections/posts/create')
  const chooser = page.getByRole('dialog', { name: 'Create a Post · Choose a template', exact: true })
  await expect(chooser).toBeVisible()
  await expect(chooser.getByRole('button', { name: /Standard Article/ })).toHaveCount(0)
  await chooser.getByRole('button', { name: /Blank/ }).click()
  await chooser.getByRole('button', { name: 'Create Post', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Template', exact: true }).getByRole('option', { name: 'Standard Article', exact: true })).toHaveCount(0)
})
