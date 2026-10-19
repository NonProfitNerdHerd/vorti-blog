import { expect, test } from '@playwright/test'
test.use({ actionTimeout: 20000 })

test('compact column menus, personal layout, collaborators and shared time controls', async ({
  page,
}) => {
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const username = `columns-ui-${Date.now()}`
  const created = await page.request.post('/api/users', {
    data: {
      username,
      email: `${username}@example.invalid`,
      password: 'columns-browser-password',
      role: 'editor',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const collaboratorResponse = await page.request.post('/api/users', {
    data: {
      username: `${username}-c`,
      email: `${username}-c@example.invalid`,
      password: 'columns-browser-password',
      role: 'editor',
    },
  })
  expect(collaboratorResponse.ok(), await collaboratorResponse.text()).toBe(true)
  const collaborator = (await collaboratorResponse.json()).doc
  await page.request.post('/api/users/logout')
  await page.request.post('/api/users/login', {
    data: { username, password: 'columns-browser-password' },
  })
  await page.goto('/admin/collections/review-tasks')
  await page
    .getByRole('complementary', { name: 'Projects and boards' })
    .getByRole('link', { name: "Personal To-Do's", exact: true })
    .click()
  await expect(page).toHaveURL(/board=\d+/)
  const board = new URL(page.url()).searchParams.get('board')
  const membership = await page.request.post('/api/task-board-memberships', {
    data: { board: Number(board), user: collaborator.id, role: 'editor' },
  })
  expect(membership.ok(), await membership.text()).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  const entry = page.getByLabel('Add task in Open', { exact: true })
  await expect(entry).toHaveAttribute('placeholder', /Add task$/)
  const row = entry.locator('xpath=ancestor::tr')
  await row.click({ position: { x: 400, y: 20 } })
  await expect(entry).toBeFocused()
  await entry.fill('Tracked example')
  await entry.press('Enter')
  await expect(page.getByRole('button', { name: 'Tracked example', exact: true })).toBeVisible()
  const heading = page
    .locator('th')
    .filter({ has: page.getByRole('button', { name: 'Column options for Status', exact: true }) })
  expect((await heading.boundingBox())!.height).toBeLessThanOrEqual(44)
  const menu = page.locator('.workspace-popover-menu:popover-open')
  await page.getByRole('button', { name: 'Column options for Assignee', exact: true }).click()
  await expect(menu.getByRole('button', { name: 'Edit field', exact: true })).toHaveCount(0)
  await menu.getByRole('button', { name: 'Move column right', exact: true }).click()
  await expect
    .poll(async () =>
      (await page.locator('thead .workspace-column-heading > span').allTextContents()).map((text) =>
        text.trim().replace(/^◉\s*/, ''),
      ),
    )
    .toEqual(['Task', 'Status', 'Due date', 'Assignee', 'Priority', 'Estimated hours'])
  await page.getByRole('button', { name: 'Column options for Priority', exact: true }).click()
  const hiddenSaved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/task-board-preferences') &&
      ['PATCH', 'POST'].includes(response.request().method()) &&
      response.ok(),
  )
  await menu.getByRole('button', { name: 'Hide column', exact: true }).click()
  await hiddenSaved
  await expect(
    page.getByRole('button', { name: 'Column options for Priority', exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Column options for Priority', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Column options for Task', exact: true }).click()
  await expect(menu.getByRole('button', { name: 'Hide column', exact: true })).toHaveCount(0)
  await menu.getByRole('button', { name: 'Filter', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Value', { exact: true }).fill('not present')
  await dialog.getByRole('button', { name: 'Apply filter', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Tracked example', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Column options for Task', exact: true }).click()
  await menu.getByRole('button', { name: 'Filter', exact: true }).click()
  await dialog.getByRole('button', { name: 'Clear filter', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Tracked example', exact: true })).toBeVisible()
  await page
    .getByRole('button', {
      name: 'Edit assignee and collaborators for Tracked example',
      exact: true,
    })
    .click()
  await dialog
    .getByRole('combobox', { name: 'Primary assignee', exact: true })
    .selectOption({ label: username })
  await dialog.locator('summary').filter({ hasText: 'Collaborators' }).click()
  await dialog.getByRole('checkbox', { name: `@${username}-c`, exact: true }).check()
  await dialog.getByRole('button', { name: 'Save people', exact: true }).click()
  await expect(page.locator('.workspace-primary-avatar')).toHaveCount(1)
  await expect(page.locator('.workspace-assignee-stack .workspace-person-avatar')).toHaveCount(2)
  const statusHeader = page
    .locator('th')
    .filter({ has: page.getByRole('button', { name: 'Column options for Status', exact: true }) })
  const dueHeader = page
    .locator('th')
    .filter({ has: page.getByRole('button', { name: 'Column options for Due date', exact: true }) })
  await statusHeader.dragTo(dueHeader, { targetPosition: { x: 100, y: 15 } })
  await expect
    .poll(async () => {
      const labels = (
        await page.locator('thead .workspace-column-heading > span').allTextContents()
      ).map((text) => text.trim())
      return labels.indexOf('Due date') < labels.indexOf('Status')
    })
    .toBe(true)
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  await dialog
    .locator('.workspace-field-types')
    .getByRole('button', { name: /^Time Tracking/ })
    .click()
  await dialog.getByLabel('Name', { exact: true }).fill('Recorded time')
  await dialog.getByRole('button', { name: 'Create and add field', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Start time for Tracked example', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Pause time for Tracked example', exact: true }),
  ).toBeEnabled()
  await expect(page.getByLabel('Total time for Tracked example', { exact: true })).toHaveText(
    /\d+:\d{2}:\d{2}/,
  )
  await expect(page.getByLabel('Total time for Tracked example', { exact: true })).not.toHaveText(
    '0:00:00',
    { timeout: 10000 },
  )
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Pause time for Tracked example', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Pause time for Tracked example', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Start time for Tracked example', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Time log for Tracked example', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('columnheader', { name: 'Person', exact: true })).toBeVisible()
  await expect(dialog.locator('tbody tr')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Change history', exact: true }).click()
  await expect(dialog.locator('tbody tr')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.screenshot({ path: '.wrangler/compact-columns-desktop.png', fullPage: true })
  await page
    .context()
    .addCookies([{ name: 'payload-theme', value: 'dark', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Tracked example', exact: true })).toBeVisible()
  await page.screenshot({ path: '.wrangler/compact-columns-desktop-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '.wrangler/compact-columns-mobile-dark.png', fullPage: true })
})
