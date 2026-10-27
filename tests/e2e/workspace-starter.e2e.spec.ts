import { createBrowserUser } from '../helpers/browser-user'
import { expect, test } from '@playwright/test'

test('starter navigator, persistent caret, independent create popup, archive and mobile layout', async ({
  page,
}) => {
  const suffix = Date.now()
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const response = await createBrowserUser(page.request, {
    data: {
      username: `starter-ui-${suffix}`,
      email: `starter-ui-${suffix}@example.invalid`,
      password: 'starter-browser-password',
      role: 'editor',
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  await page.request.post('/api/users/logout')
  await page.request.post('/api/users/login', {
    data: {
      username: `starter-ui-${suffix}`,
      password: 'starter-browser-password',
    },
  })
  await page.goto('/admin/collections/review-tasks', { waitUntil: 'domcontentloaded' })
  const tree = page.getByRole('complementary', { name: 'Projects and boards' })
  const work = tree.getByRole('link', { name: 'Work', exact: true })
  const board = tree.getByRole('link', { name: "Personal To-Do's", exact: true })
  await expect(work).toBeVisible()
  await expect(board).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Tasks workspace' })
      .getByRole('link', { name: 'Projects', exact: true }),
  ).toHaveCount(0)
  await tree.getByRole('button', { name: 'Collapse Work', exact: true }).click()
  await expect(tree.getByRole('button', { name: 'Expand Work', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(board).toBeHidden()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(tree.getByRole('button', { name: 'Expand Work', exact: true })).toBeVisible()
  await tree.getByRole('button', { name: 'Create project beside Work', exact: true }).click()
  const popup = page.getByRole('dialog', { name: 'Create project', exact: true })
  await expect(popup).toBeVisible()
  await page.screenshot({ path: '.wrangler/starter-create-project.png' })
  await expect(board).toBeHidden()
  await popup.getByLabel('Name', { exact: true }).fill(`Created from navigator ${suffix}`)
  // A failed request must leave the dialog and draft intact.
  await page.route(
    '**/api/task-projects?depth=0',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Please retry saving.' }),
      }),
    { times: 1 },
  )
  await popup.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect(popup.getByRole('alert')).toContainText('Please retry saving.')
  await expect(popup.getByLabel('Name', { exact: true })).toHaveValue(
    `Created from navigator ${suffix}`,
  )
  await popup.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect(popup).toBeHidden()
  await expect(page).toHaveURL(/workspace=projects&project=\d+/)
  await expect(
    tree.getByRole('link', { name: `Created from navigator ${suffix}`, exact: true }),
  ).toBeVisible()
  await work.click()
  await expect(work).toHaveAttribute('aria-current', 'page')
  await tree.getByRole('button', { name: 'Expand Work', exact: true }).click()
  await expect(board).toBeVisible()
  await board.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('workspace')).toBe('boards')
  await expect(page.getByRole('heading', { name: "Personal To-Do's", exact: true })).toBeVisible()
  await page.screenshot({ path: '.wrangler/starter-desktop.png' })
  for (const mode of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: mode })
    await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), mode)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(tree).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({ path: `.wrangler/starter-mobile-${mode}.png` })
  }
  await page.setViewportSize({ width: 1500, height: 1000 })
  const projects = await (await page.request.get('/api/task-projects?depth=0&limit=100')).json()
  const boards = await (await page.request.get('/api/task-boards?depth=0&limit=100')).json()
  for (const item of boards.docs) {
    const archived = await page.request.patch(`/api/task-boards/${item.id}`, {
      data: { archived: true, expectedUpdatedAt: item.updatedAt },
    })
    expect(archived.ok(), await archived.text()).toBe(true)
  }
  for (const item of projects.docs) {
    const archived = await page.request.patch(`/api/task-projects/${item.id}`, {
      data: { archived: true, expectedUpdatedAt: item.updatedAt },
    })
    expect(archived.ok(), await archived.text()).toBe(true)
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(tree.getByRole('button', { name: 'Add project', exact: true })).toBeVisible()
  await expect(tree.getByRole('link', { name: 'Work', exact: true })).toHaveCount(0)
  await tree.getByRole('button', { name: 'Add project', exact: true }).click()
  await expect(popup).toBeVisible()
  await popup.getByLabel('Name', { exact: true }).fill('Keyboard project')
  await page.keyboard.press('Tab')
  await expect(popup.getByLabel('Description', { exact: true })).toBeFocused()
})
