import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(response.ok()).toBe(true)
})

test('create a board and shared task, organize views, schedule, and edit subtasks', async ({
  page,
}) => {
  const name = `Launch board ${Date.now()}`
  await page.goto('/admin/collections/review-tasks?workspace=boards')
  await page.getByRole('button', { name: 'Create board', exact: true }).click()
  const dialog = page.locator('.editor-dialog-layer')
  await dialog.getByLabel('Board name', { exact: true }).fill(name)
  await dialog
    .getByLabel('Description', { exact: true })
    .fill('Coordinate publishing without losing context.')
  await dialog.getByRole('button', { name: 'Create board', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.locator('.task-board-directory').getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByLabel('Add task in Unsectioned', { exact: true }).fill('Prepare launch')
  await page.getByLabel('Add task in Unsectioned', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Prepare launch', exact: true }).click()
  await dialog.getByLabel('Description', { exact: true }).fill('Coordinate @workspace-')
  await expect(dialog.getByRole('option', { name: /@workspace-admin/ })).toBeVisible()
  await dialog.getByLabel('Description', { exact: true }).press('Enter')
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Task details', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toBeEnabled()
  await expect(
    dialog.getByText('Task details, comments, and subtasks are shared', { exact: false }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Add subtask', exact: true }).click()
  await dialog.getByLabel('Task title', { exact: true }).fill('Check accessibility')
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prepare launch', exact: true })).toBeVisible()
  await page.getByText('Manage sections', { exact: true }).click()
  await page.getByLabel('New section', { exact: true }).fill('Publishing')
  await page.getByRole('button', { name: 'Add section', exact: true }).click()
  await expect(page.getByRole('button', { name: '▾ Publishing', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  const card = page
    .locator('.workspace-kanban article')
    .filter({ has: page.getByRole('button', { name: 'Prepare launch', exact: true }) })
  const move = card.getByRole('combobox', { name: 'Move Prepare launch to' })
  await move.selectOption({ label: 'Publishing' })
  await expect(
    page
      .locator('.workspace-kanban>section')
      .filter({ has: page.getByRole('heading', { name: /^Publishing/ }) })
      .getByRole('button', { name: 'Prepare launch', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  const undated = page
    .locator('.task-workspace-toolbar')
    .filter({ has: page.getByRole('button', { name: 'Prepare launch', exact: true }) })
  await undated.getByLabel('Schedule Prepare launch', { exact: true }).fill('2026-10-20')
  await page.getByLabel('Calendar date', { exact: true }).fill('2026-10-20')
  await expect(
    page
      .locator('.workspace-calendar>section[aria-label="2026-10-20"]')
      .getByRole('button', { name: 'Prepare launch', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByText('Loading tasks…', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '.wrangler/workspace-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: '.wrangler/workspace-mobile-dark.png', fullPage: true })
})

test('mentions reach a permitted account inbox and open the exact comment', async ({
  page,
  playwright,
  baseURL,
}) => {
  const suffix = Date.now()
  const userResponse = await page.request.post('/api/users', {
    data: {
      username: `mention-${suffix}`,
      email: `mention-${suffix}@example.invalid`,
      password: 'local-test-pass',
      role: 'editor',
    },
  })
  expect(userResponse.ok(), await userResponse.text()).toBe(true)
  const user = (await userResponse.json()).doc
  const board = (
    await (
      await page.request.post('/api/task-boards', { data: { name: `Mentions ${suffix}` } })
    ).json()
  ).doc
  const membership = await page.request.post('/api/task-board-memberships', {
    data: { board: board.id, user: user.id, role: 'commenter' },
  })
  expect(membership.ok(), await membership.text()).toBe(true)
  const task = (
    await (
      await page.request.post('/api/review-tasks', { data: { title: `Mention task ${suffix}` } })
    ).json()
  ).doc
  const share = await page.request.post(`/api/review-tasks/${task.id}/workspace`, {
    data: { action: 'share', board: board.id, confirm: true },
  })
  expect(share.ok(), await share.text()).toBe(true)
  await page.goto(`/admin/collections/review-tasks?task=${task.id}`)
  const dialog = page.locator('.editor-dialog-layer')
  await dialog.getByRole('tab', { name: 'Comment Log', exact: true }).click()
  await dialog.getByLabel('Add comment', { exact: true }).fill(`Please review @mention-${suffix}`)
  await expect(dialog.getByRole('option', { name: new RegExp(`@mention-${suffix}`) })).toBeVisible()
  await dialog.getByLabel('Add comment', { exact: true }).press('Enter')
  await dialog.getByRole('button', { name: 'Post comment', exact: true }).click()
  await expect(
    dialog.locator('article').getByText(`Please review @mention-${suffix}`, { exact: true }),
  ).toBeVisible()
  await expect(dialog.getByLabel('Add comment', { exact: true })).toHaveValue('')
  const context = await playwright.request.newContext({ baseURL })
  await context.post('/api/users/login', {
    data: { email: user.email, password: 'local-test-pass' },
  })
  const inbox = await context.get('/api/task-notifications?depth=0')
  expect(inbox.ok()).toBe(true)
  const notices = (await inbox.json()).docs
  expect(notices.some((n: { kind: string }) => n.kind === 'invitation')).toBe(true)
  expect(
    notices.some((n: { kind: string; task: number }) => n.kind === 'mention' && n.task === task.id),
  ).toBe(true)
  await context.dispose()
  await page.request.post('/api/users/logout')
  await page.request.post('/api/users/login', {
    data: { email: user.email, password: 'local-test-pass' },
  })
  await page.goto('/admin/collections/review-tasks?workspace=inbox')
  await page.getByRole('button', { name: 'Open task and comment', exact: true }).click()
  await expect(
    page.locator('.editor-dialog-layer').getByLabel('Task title', { exact: true }),
  ).toHaveValue(task.title)
  await expect(page).toHaveURL(/comment=/)
})
