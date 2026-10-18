import { expect, test } from '@playwright/test'

test.use({ navigationTimeout: 120000 })

test.beforeEach(async ({ page }) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
        timeout: 120000,
      })
    ).ok(),
  ).toBeTruthy()
})

test('settings sections save independently, retain errors and render public destinations', async ({
  page,
}) => {
  test.setTimeout(420000)
  const original = await (await page.request.get('/api/globals/site-settings?depth=0')).json()
  const suffix = Date.now()
  const pages: number[] = []
  let iconID: number | undefined
  const createPage = async (slug: string, title: string) => {
    const response = await page.request.post('/api/pages', {
      data: {
        title,
        slug,
        _status: 'published',
        contentLayout: {
          version: 1,
          nodes: [{ id: 'body', kind: 'paragraph', text: 'Settings destination content' }],
        },
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const doc = (await response.json()).doc
    pages.push(doc.id)
    return doc
  }
  try {
    const image = await page.request.post('/api/media', {
      multipart: {
        _payload: JSON.stringify({ alt: 'Settings icon test' }),
        file: {
          name: `hub-icon-${suffix}.png`,
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
            'base64',
          ),
        },
      },
    })
    expect(image.ok(), await image.text()).toBeTruthy()
    const icon = (await image.json()).doc
    iconID = icon.id
    const home = await createPage(`hub-home-${suffix}`, `Hub homepage ${suffix}`)
    const blog = await createPage(`hub-news-${suffix}`, `Hub news ${suffix}`)
    await page.goto('/admin/globals/system-settings')
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await page.getByLabel('Site Title', { exact: true }).fill(`Hub site ${suffix}`)
    await page.getByLabel('Site Icon', { exact: true }).selectOption(String(icon.id))
    await page.getByLabel('Timezone', { exact: true }).fill('America/Chicago')
    await page.getByLabel('Date Format', { exact: true }).selectOption('iso')
    await page.getByLabel('Time Format', { exact: true }).selectOption('24')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.locator('.settings-hub__actions [role="status"]')).toContainText(
      'General settings saved.',
    )
    await page.reload()
    await expect(page.getByLabel('Site Title', { exact: true })).toHaveValue(`Hub site ${suffix}`)
    await page.getByRole('button', { name: 'Reading', exact: true }).click()
    await page.getByLabel('Homepage', { exact: true }).selectOption(String(home.id))
    await page.getByLabel('Posts Page', { exact: true }).selectOption(String(home.id))
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.locator('.settings-hub__error')).toContainText('different pages')
    await expect(page.getByLabel('Homepage', { exact: true })).toHaveValue(String(home.id))
    await page.getByLabel('Posts Page', { exact: true }).selectOption(String(blog.id))
    await page.getByRole('switch', { name: 'Discourage search engines' }).check()
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.locator('.settings-hub__actions [role="status"]')).toContainText(
      'Reading settings saved.',
    )
    await page.getByRole('button', { name: 'Privacy', exact: true }).click()
    await page.getByLabel('Privacy Policy page', { exact: true }).selectOption(String(home.id))
    await page
      .getByRole('switch', { name: 'Show a Privacy Policy footer link', exact: true })
      .check()
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.locator('.settings-hub__actions [role="status"]')).toContainText(
      'Privacy settings saved.',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await expect(page.locator('.settings-hub__actions button')).toHaveText('Save changes')
    await page.screenshot({ path: '.wrangler/settings-hub-mobile.png', fullPage: true })
    await page.getByRole('button', { name: 'Features', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.screenshot({ path: '.wrangler/settings-hub-mobile-dark.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: 'General', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('form', { name: 'General settings' })).toBeVisible()
    await page.screenshot({ path: '.wrangler/settings-hub-desktop-dark.png', fullPage: true })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
    await page.screenshot({ path: '.wrangler/settings-hub-desktop.png', fullPage: true })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: home.title, exact: true })).toBeVisible()
    expect(await page.locator('link[rel="icon"]').first().getAttribute('href')).toContain(
      icon.filename,
    )
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    )
    await expect(page.getByRole('link', { name: 'Privacy Policy', exact: true })).toHaveAttribute(
      'href',
      '/',
    )
    await page.goto('/posts?page=1&example=kept')
    await expect(page).toHaveURL(new RegExp(`/${blog.slug}\\?page=1&example=kept`))
    await expect(page.getByRole('heading', { name: blog.title, exact: true })).toBeVisible()
    expect(
      (
        await page.request.post('/api/globals/site-settings', {
          data: { timezone: 'invalid/timezone' },
        })
      ).status(),
    ).toBe(400)
    const resource = await page.request.post('/api/form-resources', {
      data: { label: `Hub timezone ${suffix}` },
    })
    expect(resource.ok(), await resource.text()).toBeTruthy()
    const resourceDoc = (await resource.json()).doc
    expect(resourceDoc.timezone).toBe('America/Chicago')
    await page.request.delete(`/api/form-resources/${resourceDoc.id}`)
    await page.goto('/admin/collections/form-resources/create')
    await expect(page.getByLabel('Timezone', { exact: true })).toHaveValue('America/Chicago')
  } finally {
    await page.request.post('/api/globals/site-settings', { data: original })
    for (const id of pages.reverse()) await page.request.delete(`/api/pages/${id}`)
    if (iconID) await page.request.delete(`/api/media/${iconID}`)
  }
})

test('tag role policy blocks direct mutations but keeps existing tag assignment available', async ({
  page,
  playwright,
}) => {
  test.setTimeout(240000)
  const original = await (await page.request.get('/api/globals/system-settings?depth=0')).json()
  const suffix = Date.now()
  const users: number[] = []
  const tags: number[] = []
  let postID: number | undefined
  try {
    const tagResponse = await page.request.post('/api/tags', {
      data: { name: `Hub tag ${suffix}` },
    })
    expect(tagResponse.ok()).toBeTruthy()
    const tag = (await tagResponse.json()).doc
    tags.push(tag.id)
    await page.goto('/admin/globals/system-settings')
    await page.getByRole('button', { name: 'Features', exact: true }).click()
    await expect(
      page.getByRole('checkbox', { name: 'Administrator (always allowed)', exact: true }),
    ).toBeDisabled()
    await page.getByRole('checkbox', { name: 'Editor', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(page.locator('.settings-hub__actions [role="status"]')).toContainText(
      'Features settings saved.',
    )
    for (const role of ['editor', 'designer']) {
      const email = `hub-${role}-${suffix}@example.com`
      const userResponse = await page.request.post('/api/users', {
        data: { username: (email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(-32), email, password: 'local-hub-test-password', role },
      })
      expect(userResponse.ok(), await userResponse.text()).toBeTruthy()
      const userID = (await userResponse.json()).doc.id
      users.push(userID)
      const context = await playwright.request.newContext({ baseURL: 'http://localhost:3100' })
      try {
        expect(
          (
            await context.post('/api/users/login', {
              data: { email, password: 'local-hub-test-password' },
            })
          ).ok(),
        ).toBeTruthy()
        const created = await context.post('/api/tags', { data: { name: `${role} tag ${suffix}` } })
        expect(created.status()).toBe(role === 'editor' ? 403 : 201)
        if (created.ok()) tags.push((await created.json()).doc.id)
        const changed = await context.patch(`/api/tags/${tag.id}`, { data: { description: role } })
        expect(changed.status()).toBe(role === 'editor' ? 403 : 200)
        if (role === 'editor') {
          expect((await context.delete(`/api/tags/${tag.id}`)).status()).toBe(403)
          const post = await context.post('/api/posts', {
            data: {
              title: `Tag assignment ${suffix}`,
              slug: `tag-assignment-${suffix}`,
              tags: [tag.id],
              author: userID,
              contentLayout: {
                version: 1,
                nodes: [{ id: 'body', kind: 'paragraph', text: 'Tag permission verification' }],
              },
              _status: 'draft',
            },
          })
          expect(post.ok(), await post.text()).toBeTruthy()
          const doc = (await post.json()).doc
          postID = doc.id
          expect(doc.tags[0].id || doc.tags[0]).toBe(tag.id)
        }
        expect(
          (
            await context.post('/api/globals/system-settings', {
              data: { tagManagementRoles: [role] },
            })
          ).status(),
        ).toBe(403)
      } finally {
        await context.dispose()
      }
    }
  } finally {
    await page.request.post('/api/globals/system-settings', { data: original })
    if (postID) await page.request.delete(`/api/posts/${postID}`)
    for (const id of tags) await page.request.delete(`/api/tags/${id}`)
    for (const id of users) await page.request.delete(`/api/users/${id}`)
  }
})
