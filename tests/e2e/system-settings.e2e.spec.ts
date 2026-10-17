import { expect, test, type APIRequestContext } from '@playwright/test'

async function create(request: APIRequestContext, collection: string, data: object) {
  const response = await request.post(`/api/${collection}`, { data })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).doc
}
test.beforeEach(async ({ page }) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBeTruthy()
})

test('navigation defaults, dashboard preference and local opening survive route transitions correctly', async ({
  page,
}) => {
  const preference = await (
    await page.request.get('/api/payload-preferences/vorti-dashboard-sidebar')
  ).json()
  const endpoint = `/api/payload-preferences${preference.id ? `/${preference.id}` : ''}?depth=0`
  await page.request[preference.id ? 'patch' : 'post'](endpoint, {
    data: { key: 'vorti-dashboard-sidebar', value: { open: true } },
  })
  await page.goto('/admin')
  await expect(page.locator('.nav')).toHaveClass(/nav--nav-open/)
  const dashboard = page.locator('.vorti-dashboard-link')
  await expect(dashboard).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: /^Close Menu$/i }).click()
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/payload-preferences/vorti-dashboard-sidebar')).json())
          .value?.open,
    )
    .toBe(false)
  await page.reload()
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  await page.goto('/admin/collections/posts')
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  await page.getByRole('button', { name: /^Open Menu$/i }).click()
  await expect(page.locator('.nav')).toHaveClass(/nav--nav-open/)
  await page.locator('a#nav-pages').click()
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  await page.getByRole('button', { name: /^Open Menu$/i }).click()
  await page.locator('.vorti-dashboard-link').click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.app-header__mobile-nav-toggler').click()
  await expect(page.locator('.nav')).toHaveClass(/nav--nav-open/)
  await page.locator('a#nav-posts').click()
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
})

test('Categories switch saves, preserves assignments and saved rules, blocks writes and restores controls', async ({
  page,
}) => {
  test.setTimeout(240000)
  const original = await (await page.request.get('/api/globals/system-settings')).json()
  expect((await page.request.post('/api/globals/system-settings', { data: { categoriesEnabled: true } })).ok()).toBeTruthy()
  const suffix = Date.now()
  const { user } = await (await page.request.get('/api/users/me')).json()
  const category = await create(page.request, 'categories', {
    name: `Switch category ${suffix}`,
    slug: `switch-${suffix}`,
  })
  const post = await create(page.request, 'posts', {
    title: `Switch post ${suffix}`,
    slug: `switch-post-${suffix}`,
    author: user.id,
    categories: [category.id],
    _status: 'published',
    contentLayout: {
      version: 1,
      nodes: [{ id: 'p', kind: 'paragraph', text: 'Settings verification' }],
    },
  })
  const configuration = {
    version: 1,
    layout: 'grid-1',
    query: {
      source: 'posts',
      ids: [String(post.id)],
      rules: [{ field: 'categories', operator: 'any', values: [String(category.id)] }],
    },
    filters: true,
  }
  try {
    await page.goto('/admin/globals/system-settings')
    const toggle = page.getByRole('switch', { name: 'Categories', exact: true })
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/globals/system-settings')).json()).categoriesEnabled,
      )
      .toBe(false)
    await page.getByRole('button', { name: /^Open Menu$/i }).click()
    await expect(page.locator('a#nav-categories')).toHaveCount(0)
    await page.screenshot({ path: '.wrangler/site-settings-desktop.png', animations: 'disabled' })
    await page.reload()
    await expect(toggle).not.toBeChecked()
    for (const [method, url, data] of [
      ['post', '/api/categories', { name: 'Blocked', slug: `blocked-${suffix}` }],
      ['patch', `/api/categories/${category.id}`, { name: 'Blocked' }],
      ['delete', `/api/categories/${category.id}`, undefined],
      ['patch', `/api/posts/${post.id}`, { categories: [] }],
    ] as const) {
      const result = await page.request[method](url, { data })
      expect(result.ok(), `${method} ${url} must be rejected`).toBe(false)
    }
    const saved = await page.request.patch(`/api/posts/${post.id}?depth=0`, {
      data: { title: `Updated ${suffix}` },
    })
    expect(saved.ok(), await saved.text()).toBeTruthy()
    expect((await saved.json()).doc.categories).toEqual([category.id])
    const view = await page.request.post('/api/content-views', { data: { configuration } })
    expect(view.ok(), await view.text()).toBeTruthy()
    const projection = await view.json()
    expect(projection.items.map((item: { id: string }) => item.id)).toContain(String(post.id))
    expect(projection.items[0].categories).toEqual([])
    expect(projection.categoriesEnabled).toBe(false)
    await page.goto(`/posts/${post.slug}`)
    await expect(page.getByText(category.name, { exact: false })).toHaveCount(0)
    await page.goto(`/admin/collections/posts/${post.id}`)
    await page.getByRole('tab', { name: 'Document settings', exact: true }).click()
    await expect(page.locator('.builder-document-settings')).toBeVisible()
    await expect(page.locator('#field-categories')).toHaveCount(0)
    await page.goto('/admin/globals/system-settings')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    await page.screenshot({
      path: '.wrangler/site-settings-mobile-dark.png',
      animations: 'disabled',
    })
    await toggle.focus()
    await toggle.press('Space')
    await expect(toggle).toBeChecked()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/globals/system-settings')).json()).categoriesEnabled,
      )
      .toBe(true)
    await page.goto(`/posts/${post.slug}`)
    await expect(page.getByText(category.name, { exact: false })).toBeVisible()
  } finally {
    await page.request.post('/api/globals/system-settings', {
      data: { categoriesEnabled: original.categoriesEnabled !== false },
    })
  }
})

test('only administrators can change system settings and dashboard preferences are user-specific', async ({
  page,
  browser,
  baseURL,
}) => {
  for (const role of ['designer', 'editor']) {
    const email = `settings-${role}-${Date.now()}@example.invalid`
    await create(page.request, 'users', { email, password: 'test-settings-password', role })
    const context = await browser.newContext({ baseURL, viewport: { width: 1800, height: 1100 } })
    await context.request.post('/api/users/login', {
      data: { email, password: 'test-settings-password' },
    })
    const result = await context.request.post('/api/globals/system-settings', {
      data: { categoriesEnabled: false },
    })
    expect(result.status()).toBe(403)
    const other = await context.newPage()
    await other.goto('/admin')
    await expect(other.locator('.nav')).toHaveClass(/nav--nav-open/)
    await expect(other.locator('a#nav-system-settings')).toHaveCount(0)
    await other.goto('/admin/globals/system-settings')
    await expect(other).toHaveURL(/\/admin$/)
    await context.close()
  }
})
