import { createBrowserUser } from '../helpers/browser-user'
import { test, expect } from '@playwright/test'
test.use({ actionTimeout: 20000 })
test('readable groups, section dialogs, field wizard, notifications, Gantt Timeline and Calendar views', async ({
  page,
}) => {
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const username = `board-ui-${Date.now()}`
  const user = await createBrowserUser(page.request, {
    data: {
      username,
      email: `${username}@example.invalid`,
      password: 'board-browser-password',
      role: 'editor',
    },
  })
  expect(user.ok(), await user.text()).toBe(true)
  await page.request.post('/api/users/logout')
  await page.request.post('/api/users/login', {
    data: { username, password: 'board-browser-password' },
  })
  await page.goto('/admin/collections/review-tasks')
  await page
    .getByRole('complementary', { name: 'Projects and boards' })
    .getByRole('link', { name: "Personal To-Do's", exact: true })
    .click()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  const open = page.getByRole('button', { name: 'Open', exact: true })
  await expect(open).toBeVisible()
  expect(await open.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')
  expect(
    await open.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(18)
  await page.getByRole('button', { name: 'Options for Open', exact: true }).click()
  const menu = page.locator('.workspace-popover-menu:popover-open')
  await expect(menu.getByRole('button', { name: 'Rename section', exact: true })).toHaveCount(0)
  await menu.getByRole('button', { name: 'Add section', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Section name', { exact: true }).fill('Planning')
  await dialog.getByRole('button', { name: 'Save section', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Planning', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Options for Planning', exact: true }).click()
  await menu.getByRole('button', { name: 'Rename section', exact: true }).click()
  await dialog.getByLabel('Section name', { exact: true }).fill('Preparation')
  await dialog.getByRole('button', { name: 'Save section', exact: true }).click()
  await page.getByLabel('Add task in Preparation', { exact: true }).fill('Plan launch')
  await page.getByLabel('Add task in Preparation', { exact: true }).press('Enter')
  await expect(page.getByLabel('Add task in Preparation', {exact: true})).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Open task', exact: true })).toHaveCount(0)
  await expect(page.locator('.workspace-success-notice')).toHaveCount(0, { timeout: 10000 })
  await page.getByRole('button', { name: 'Options for Preparation', exact: true }).click()
  await menu.getByRole('button', { name: 'Duplicate section', exact: true }).click()
  await dialog.getByLabel('Section name', { exact: true }).fill('Preparation copy')
  await dialog.getByRole('button', { name: 'Save section', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Preparation copy', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Plan launch', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  await dialog
    .locator('.workspace-field-types')
    .getByRole('button', { name: /^Single Select/ })
    .click()
  await dialog.getByLabel('Name', { exact: true }).fill('Category')
  await dialog.getByRole('button', { name: 'Add option', exact: true }).click()
  await dialog.getByLabel('Option 1', { exact: true }).fill('Health')
  await dialog.getByLabel('Option 1 color', { exact: true }).fill('#ff0000')
  await dialog.getByRole('button', { name: 'Add option', exact: true }).click()
  await dialog.getByLabel('Option 2', { exact: true }).fill('Home')
  await page.route(
    '**/api/task-board-fields?depth=0',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Retry attaching the column' }),
      }),
    { times: 1 },
  )
  await dialog.getByRole('button', { name: 'Create and add field', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Retry attaching')
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Category')
  await dialog.getByRole('button', { name: 'Save definition', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Health' })
  await expect(page.locator('.workspace-success-notice')).toContainText('Plan launch was updated')
  await page.getByRole('button', { name: 'Group tasks', exact: true }).click()
  await menu.getByRole('button', { name: 'Category', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Health', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  await dialog
    .locator('.workspace-field-types')
    .getByRole('button', { name: /^Formula/ })
    .click()
  await dialog.getByLabel('Name', { exact: true }).fill('Summary')
  await dialog.getByLabel('Find formula input', { exact: true }).fill('Task title')
  await dialog.getByRole('button', { name: 'Task title', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Expression', exact: true })).toHaveValue(
    '[ntitle]',
  )
  await dialog
    .getByRole('textbox', { name: 'Expression', exact: true })
    .fill('concat([ntitle]," ",[nstatus])')
  await dialog.getByRole('button', { name: 'Create and add field', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Plan launch open', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Column options for Priority', exact: true }).click()
  await menu.getByRole('button', { name: 'Edit field', exact: true }).click()
  await dialog.getByLabel('high', { exact: true }).fill('#7c3aed')
  await dialog.getByRole('button', { name: 'Save colors', exact: true }).click()
  // selectOption can act on a background control while the modal is saving.
  // Follow the user-visible completion before editing the Task's priority.
  await expect(dialog).toHaveCount(0)
  await page.getByLabel('Priority for Plan launch', { exact: true }).selectOption('high')
  await expect(page.getByLabel('Priority for Plan launch', { exact: true })).toHaveCSS(
    'border-left-color',
    'rgb(124, 58, 237)',
  )
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(page.locator('.workspace-timeline-scroll')).toBeVisible()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Group tasks', exact: true })).toHaveCount(0)
  expect(
    (await page.getByLabel('Calendar date', { exact: true }).boundingBox())!.width,
  ).toBeLessThanOrEqual(180)
  await expect(page.getByRole('button', { name: 'Month view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const heading = page.locator('.workspace-calendar-controls h3'),
    period = await heading.textContent()
  await page.getByRole('button', { name: 'Next calendar period', exact: true }).click()
  await expect(heading).not.toHaveText(period!)
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(heading).toHaveText(period!)
  await page.getByRole('button', { name: 'Week view', exact: true }).click()
  await expect(page.locator('.workspace-calendar>section')).toHaveCount(7)
  await page.getByRole('button', { name: 'Agenda view', exact: true }).click()
  const date = await page.evaluate(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  await page.getByLabel('Schedule Plan launch', { exact: true }).fill(date)
  await expect(page.getByText('No undated tasks.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Plan launch', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Plan launch', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Agenda view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.screenshot({ path: '.wrangler/board-refinement-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: '.wrangler/board-refinement-mobile-dark.png', fullPage: true })
})
