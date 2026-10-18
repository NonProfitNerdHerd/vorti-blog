import { expect, test } from '@playwright/test'

test('account choice updates existing public posts, native selectors and task attribution', async ({
  page,
  browser,
}) => {
  test.setTimeout(240000)
  const suffix = Date.now()
  const username = `writer-${suffix}`
  const email = `${username}@example.invalid`
  const password = 'local-attribution-browser-password'
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBeTruthy()
  const response = await page.request.post('/api/users', {
    data: {
      username,
      email,
      password,
      role: 'editor',
      displayName: `Old name ${suffix}`,
      profilePublic: false,
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const owner = (await response.json()).doc
  await page.request.post('/api/users/logout')
  await page.goto('/admin/login')
  await page.getByLabel(/email.*username/i).fill(username.toUpperCase())
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByRole('heading', { name: `Welcome back, ${username}` })).toBeVisible()
  const created = await page.request.post('/api/posts', {
    data: {
      title: `Identity article ${suffix}`,
      slug: `identity-article-${suffix}`,
      _status: 'published',
      contentLayout: {
        version: 1,
        nodes: [{ id: 'body', kind: 'paragraph', text: 'Existing article body remains intact.' }],
      },
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const post = (await created.json()).doc
  expect(typeof post.author === 'object' ? post.author.id : post.author).toBe(owner.id)
  const taskResponse = await page.request.post('/api/review-tasks', {
    data: {
      title: `Attribution review ${suffix}`,
      documentType: 'posts',
      documentID: String(post.id),
      assignee: owner.id,
      status: 'open',
    },
  })
  expect(taskResponse.ok(), await taskResponse.text()).toBeTruthy()
  const task = (await taskResponse.json()).doc
  expect(
    (
      await page.request.post('/api/review-comments', {
        data: {
          task: task.id,
          documentType: 'posts',
          documentID: String(post.id),
          body: 'Attribution comment remains linked.',
        },
      })
    ).ok(),
  ).toBeTruthy()
  const visitor = await browser.newContext()
  const publicPage = await visitor.newPage()
  const origin = new URL(test.info().project.use.baseURL!).origin
  try {
    await publicPage.goto(`${origin}/posts/${post.slug}`)
    await expect(publicPage.getByText(`By ${username}`, { exact: true })).toBeVisible()
    expect((await visitor.request.get(`${origin}/api/public/authors/${owner.slug}`)).status()).toBe(
      404,
    )
    await page.goto('/admin/account')
    await expect(page.getByLabel('Display as', { exact: true })).toHaveValue('username')
    const save = async (preference: string) => {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByLabel('Username', { exact: true })).toBeEnabled()
      await expect
        .poll(
          async () =>
            (await (await page.request.get('/api/users/me')).json()).user.attributionPreference,
        )
        .toBe(preference)
      await expect(page.getByLabel('Display as', { exact: true })).toHaveValue(preference)
    }
    await page.getByLabel('Display as', { exact: true }).selectOption('email')
    await expect(page.getByText('Attribution preview:')).toContainText(email)
    await save('email')
    await publicPage.reload()
    await expect(publicPage.getByText(`By ${email}`, { exact: true })).toBeVisible()
    const renamed = `${username}-new`
    await page.getByLabel('Username', { exact: true }).fill(renamed)
    await page.getByLabel('Display as', { exact: true }).selectOption('username')
    await save('username')
    const me = (await (await page.request.get('/api/users/me')).json()).user
    expect(me.slug).toBe(owner.slug)
    expect(me.username).toBe(renamed)
    await publicPage.reload()
    await expect(publicPage.getByText(`By ${renamed}`, { exact: true })).toBeVisible()
    expect(await publicPage.content()).not.toContain(email)
    const retained = await (await page.request.get(`/api/posts/${post.id}?depth=0`)).json()
    expect(retained.author).toBe(owner.id)
    expect(retained.updatedAt).toBe(post.updatedAt)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: '.wrangler/identity-account-mobile-dark.png',
      fullPage: true,
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 1800, height: 1100 })
    await page.goto(`/admin/collections/review-tasks?task=${task.id}`)
    const dialog = page.getByRole('dialog', { name: 'Task details' })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText('Attribution comment remains linked.', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByLabel('Assignee', { exact: true }).locator('option:checked'),
    ).toHaveText(renamed)
    await expect(
      dialog
        .locator('article')
        .filter({ hasText: 'Attribution comment remains linked.' })
        .locator('small'),
    ).toContainText(renamed)
  } finally {
    await visitor.close()
  }
})
