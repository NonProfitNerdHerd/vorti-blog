import { createBrowserUser } from '../helpers/browser-user'
import { expect, test } from '@playwright/test'
test('compact menu, personal colors, filter panel and inline task/subtask entry', async ({
  page,
}) => {
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const username = `compact-ui-${Date.now()}`
  const created = await createBrowserUser(page.request, {
    data: {
      username,
      email: `${username}@example.invalid`,
      password: 'compact-browser-password',
      role: 'editor',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  await page.request.post('/api/users/logout')
  await page.request.post('/api/users/login', {
    data: { username, password: 'compact-browser-password' },
  })
  await page.goto('/admin/collections/review-tasks')
  await expect(
    page.locator('.app-header').getByRole('heading', { name: 'Tasks', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Keep your site’s next steps in view.', { exact: true })).toHaveCount(
    0,
  )
  const tree = page.getByRole('complementary', { name: 'Projects and boards' })
  await expect(tree.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
  await expect(tree.getByRole('heading', { name: 'Projects', exact: true })).toHaveCount(0)
  const caret = tree.getByRole('button', { name: 'Collapse Work', exact: true })
  await expect(caret).toBeVisible()
  expect(await caret.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')
  expect(
    (await tree.locator('.workspace-local-menu a').allTextContents()).map((text) => text.trim()),
  ).toEqual(['Home', 'Inbox', 'My Tasks'])
  await caret.focus()
  await caret.press('Enter')
  await expect(tree.getByRole('link', { name: "Personal To-Do's", exact: true })).toBeHidden()
  await tree.getByRole('button', { name: 'Expand Work', exact: true }).press('Enter')
  await tree.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Upcoming assigned tasks' })).toBeVisible()
  await expect(
    page
      .locator('.workspace-home-panel')
      .filter({ has: page.getByRole('heading', { name: 'Recently updated boards' }) })
      .getByRole('link', { name: "Personal To-Do's", exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: '.wrangler/compact-home-desktop.png', fullPage: true })
  await tree.getByRole('link', { name: "Personal To-Do's", exact: true }).click()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0)
  await expect(page.getByPlaceholder('Search tasks…')).toBeHidden()
  await page.getByRole('button', { name: 'Filter board tasks' }).click()
  const filters = page.getByRole('dialog', { name: 'Board filters' })
  await expect(filters).toBeVisible()
  await filters.getByRole('button', { name: 'Close board filters' }).click()
  const color = tree.getByRole('button', { name: "Change personal color for Personal To-Do's" })
  await color.click()
  await page.getByRole('dialog').getByRole('button', { name: 'teal', exact: true }).click()
  await expect(color).toHaveCSS('background-color', 'rgb(15, 118, 110)')
  const title = `Inline ${Date.now()}`,
    input = page.getByLabel('Add task in Open', { exact: true })
  await input.fill(title)
  await page.route(
    '**/api/task-workspace/create*',
    (r) =>
      r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Try again' }),
      }),
    { times: 1 },
  )
  await input.press('Enter')
  await expect(input).toHaveValue('')
  const failedCreation = page.locator('.workspace-creation-errors').filter({ hasText: title })
  await expect(failedCreation).toContainText('Try again')
  await failedCreation.getByRole('button', { name: 'Retry creation', exact: true }).click()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(input).toHaveValue('')
  await page.getByRole('button', { name: `Expand subtasks for ${title}` }).click()
  const child = page.getByLabel(`Add subtask to ${title}`, { exact: true })
  await child.fill('Inline child')
  await child.press('Enter')
  await expect(page.getByRole('button', { name: 'Inline child', exact: true })).toBeVisible()
  await page.getByRole('button', { name: title, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await input.fill('Cancel me')
  await input.press('Escape')
  await expect(input).toHaveValue('')
  await page.getByRole('button', { name: 'Filter board tasks' }).click()
  await filters.getByLabel('Filter status', { exact: true }).selectOption('open')
  await filters.getByRole('button', { name: 'Close board filters' }).click()
  await expect(page).toHaveURL(/boardStatus=open/)
  const grouped = page.getByLabel('Add task in In progress', { exact: true })
  await grouped.fill('Hidden grouped task')
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/task-workspace/create') &&
      response.request().method() === 'POST',
  )
  await grouped.press('Enter')
  expect((await (await saved).json()).doc.status).toBe('in-progress')
  await expect(page.getByRole('button', { name: 'Hidden grouped task', exact: true })).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Filter board tasks' }).click()
  await filters.getByRole('button', { name: 'Reset filters and view' }).click()
  await filters.getByRole('button', { name: 'Close board filters' }).click()
  await page.getByRole('button', { name: 'Hidden grouped task', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await expect(color).toHaveCSS('background-color', 'rgb(15, 118, 110)')
  await expect(page.getByRole('heading', { name: "Personal To-Do's", exact: true })).toBeVisible()
  await expect(page.getByText('Updating board…', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '.wrangler/compact-desktop.png', fullPage: true })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: '.wrangler/compact-desktop-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: '.wrangler/compact-mobile-dark.png', fullPage: true })
  await page.getByRole('button', { name: 'Filter board tasks' }).click()
  const bounds = await filters.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.wrangler/compact-filter-mobile-dark.png', fullPage: true })
  await filters.press('Escape')
  await expect(filters).toHaveCount(0)
  await page.goto('/admin/collections/posts')
  await expect(
    page.locator('.app-header').getByRole('heading', { name: 'Tasks', exact: true }),
  ).toHaveCount(0)
})
