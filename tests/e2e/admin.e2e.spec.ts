import { test, expect, Page, type APIRequestContext } from '@playwright/test'
import { login } from '../helpers/login'
import { seedTestUser, cleanupTestUser, testUser } from '../helpers/seedUser'
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

test.describe('Admin Panel', () => {
  let page: Page

  test.beforeAll(async ({ browser }, testInfo) => {
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()

    await login({ page, user: testUser })
  })

  test.afterAll(async () => {
    await cleanupTestUser()
  })

  test('can navigate to dashboard', async () => {
    await page.goto('http://localhost:3000/admin')
    await expect(page).toHaveURL('http://localhost:3000/admin')
    const dashboardArtifact = page.locator('span[title="Dashboard"]').first()
    await expect(dashboardArtifact).toBeVisible()
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
    await expect(page.getByRole('link', { name: 'Block Creator', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Templates', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Design Variants', exact: true })).toHaveCount(0)
    await page.goto('http://localhost:3000/admin/collections/design-block-types')
    await expect(page.getByRole('heading', { name: 'Block Creator' })).toBeVisible()
    await page.goto('http://localhost:3000/admin/collections/design-templates')
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible()
  })

  test('previews the saved Standard Article Template', async () => {
    const response = await page.context().request.get('http://localhost:3000/api/design-templates?where[slug][equals]=standard-article&limit=1&depth=0')
    const body = await response.json() as { docs: Array<{ id: number }> }
    expect(body.docs).toHaveLength(1)
    await page.goto(`http://localhost:3000/admin/collections/design-templates/${body.docs[0].id}`)
    await page.getByRole('button', { name: 'Preview saved draft' }).click()
    await expect(page.getByRole('heading', { name: 'Example Hero Headline' })).toBeVisible()
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
