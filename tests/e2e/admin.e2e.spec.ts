import { test, expect, Page } from '@playwright/test'
import { login } from '../helpers/login'
import { seedTestUser, cleanupTestUser, testUser } from '../helpers/seedUser'
import { getPayload } from 'payload'
import config from '@/payload.config'

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
    const payload = await getPayload({ config })
    const users = await payload.find({ collection: 'users', where: { email: { equals: testUser.email } }, limit: 1 })
    const content = { root: { type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
      children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
        children: [{ type: 'text', text: 'Stored body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }],
    } }
    const post = await payload.create({ collection: 'posts', data: {
      title: 'SEO value Post', slug: 'seo-value-post', author: users.docs[0].id, content,
      meta: { title: 'Stored Post SEO Title', description: 'Stored Post SEO Description' },
    } })
    const pageDoc = await payload.create({ collection: 'pages', data: {
      title: 'SEO value Page', slug: 'seo-value-page', content,
      meta: { title: 'Stored Page SEO Title', description: 'Stored Page SEO Description' },
    } })
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
      await payload.delete({ collection: 'posts', id: post.id })
      await payload.delete({ collection: 'pages', id: pageDoc.id })
    }
  })

  test('offers native Live Preview for Posts and Pages', async ({ browser }) => {
    const payload = await getPayload({ config })
    const users = await payload.find({ collection: 'users', where: { email: { equals: testUser.email } }, limit: 1 })
    const content = { root: { type: 'root', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
      children: [{ type: 'paragraph', format: '' as const, indent: 0, version: 1, direction: 'ltr' as const,
        children: [{ type: 'text', text: 'Preview body', format: 0, mode: 'normal', style: '', detail: 0, version: 1 }] }],
    } }
    const post = await payload.create({ collection: 'posts', data: {
      title: 'Published Preview Post', slug: 'published-preview-post', author: users.docs[0].id,
      content, _status: 'published',
    } })
    const pageDoc = await payload.create({ collection: 'pages', data: {
      title: 'Published Preview Page', slug: 'published-preview-page', content, _status: 'published',
    } })
    const imageData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jz8AAAAASUVORK5CYII=', 'base64')
    const media = await payload.create({ collection: 'media', data: { alt: 'Live preview test image' },
      file: { data: imageData, name: 'live-preview-test.png', mimetype: 'image/png', size: imageData.length } })
    try {
      for (const [collection, id, title, route] of [
        ['posts', post.id, 'Published Preview Post', '/posts/published-preview-post'],
        ['pages', pageDoc.id, 'Published Preview Page', '/published-preview-page'],
      ] as const) {
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
      }
      const unpublished = await payload.create({ collection: 'posts', draft: true, data: {
        title: 'Unpublished Preview Post', slug: 'unpublished-preview-post', author: users.docs[0].id, content,
      } })
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
        await payload.delete({ collection: 'posts', id: unpublished.id })
      }
      const unpublishedPage = await payload.create({ collection: 'pages', draft: true, data: {
        title: 'Unpublished Preview Page', slug: 'unpublished-preview-page', content,
      } })
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
        await payload.delete({ collection: 'pages', id: unpublishedPage.id })
      }
    } finally {
      await payload.delete({ collection: 'posts', id: post.id })
      await payload.delete({ collection: 'pages', id: pageDoc.id })
      await payload.delete({ collection: 'media', id: media.id })
    }
  })
})
