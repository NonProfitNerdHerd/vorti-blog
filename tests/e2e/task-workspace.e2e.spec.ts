import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(response.ok()).toBe(true)
})

test('open existing and new projects, create a board and task, and retain project navigation', async ({
  page,
}) => {
  const suffix = Date.now()
  const existingName = `Existing project ${suffix}`
  const created = await page.request.post('/api/task-projects?site=default', {
    data: { name: existingName, visibility: 'private' },
  })
  expect(created.ok()).toBe(true)
  const existing = (await created.json()).doc
  await page.goto(
    `/admin/collections/review-tasks?workspace=projects&project=${existing.id}&site=default`,
  )
  await expect(page.getByRole('heading', { name: existingName, exact: true })).toBeVisible()
  await expect(page.getByLabel('Show boards', { exact: true })).toBeVisible()
  await expect(page.locator('.workspace-projects').getByRole('alert')).toHaveCount(0)
  const tree = page.getByRole('complementary', { name: 'Projects and boards' })
  await expect(tree.getByRole('button', { name: /Create project beside/ })).toHaveCount(0)
  await expect(tree.getByRole('button', { name: 'Add project', exact: true })).toHaveCount(0)
  const header = page.getByRole('navigation', { name: 'Tasks workspace', exact: true })
  await header.getByRole('button', { name: 'Add project', exact: true }).click()
  const dialog = page.locator('.editor-dialog-layer')
  const projectName = `Newsletter ${suffix}`
  await dialog.getByLabel('Name', { exact: true }).fill(projectName)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
  await expect(page.locator('.workspace-projects').getByRole('alert')).toHaveCount(0)
  const projectURL = page.url()
  await tree.getByRole('button', { name: `Add board to ${projectName}`, exact: true }).click()
  const boardName = `Newsletter board ${suffix}`
  await dialog.getByLabel('Board name', { exact: true }).fill(boardName)
  await dialog.getByRole('button', { name: 'Create board', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(projectURL)
  await expect(tree.getByRole('link', { name: boardName, exact: true })).toBeVisible()
  const tile = page
    .locator('.project-board-tile')
    .filter({ has: page.getByRole('heading', { name: boardName, exact: true }) })
  await expect(tile).toBeVisible()
  await expect(tile.locator('dd')).toHaveText(['0', '0', '0', '0'])
  // The project plus targets that project even while a different project is selected.
  await tree.getByRole('button', { name: `Add board to ${existingName}`, exact: true }).click()
  const otherBoard = `Other board ${suffix}`
  await dialog.getByLabel('Board name', { exact: true }).fill(otherBoard)
  await dialog.getByRole('button', { name: 'Create board', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(projectURL)
  await expect(tree.getByRole('link', { name: otherBoard, exact: true })).toBeVisible()
  await expect(page.locator('.project-board-tile').filter({ hasText: otherBoard })).toHaveCount(0)
  await page.getByLabel('Show boards', { exact: true }).selectOption('overdue')
  await expect(page.getByText('No boards match this filter.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Show boards', { exact: true })).toHaveValue('overdue')
  await page.getByLabel('Show boards', { exact: true }).selectOption('all')
  const href = await tile.getAttribute('href')
  const boardID = new URL(href!, 'http://localhost').searchParams.get('board')
  for (const [title, status, dueDate] of [
    ['Overdue example', 'open', '2020-01-01'],
    ['Completed example', 'done', null],
  ]) {
    const response = await page.request.post('/api/review-tasks?site=default', {
      data: {
        title: `${title} ${suffix}`,
        initialBoard: Number(boardID),
        status,
        priority: 'normal',
        ...(dueDate ? { dueDate: `${dueDate}T00:00:00Z` } : {}),
      },
    })
    expect(response.ok()).toBe(true)
  }
  await page.reload()
  await expect(tile.locator('dd')).toHaveText(['1', '0', '1', '2'])
  await page.getByLabel('Show boards', { exact: true }).selectOption('upcoming')
  await expect(page.getByText('No boards match this filter.', { exact: true })).toBeVisible()
  await page.getByLabel('Show boards', { exact: true }).selectOption('completed')
  await expect(tile).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('Show boards', { exact: true })).toHaveValue('upcoming')
  await page.goForward()
  await expect(page.getByLabel('Show boards', { exact: true })).toHaveValue('completed')
  await tile.click()
  await expect(page.getByRole('heading', { name: boardName, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByLabel('Add task in Open', { exact: true }).fill(`Prepare newsletter ${suffix}`)
  await page.getByLabel('Add task in Open', { exact: true }).press('Enter')
  await page.getByRole('button', { name: `Prepare newsletter ${suffix}`, exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Task details', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await expect(
    page.getByRole('button', { name: `Prepare newsletter ${suffix}`, exact: true }),
  ).toBeVisible()
  await tree.getByRole('link', { name: projectName, exact: true }).click()
  await expect(page.getByLabel('Show boards', { exact: true })).toBeVisible()
  await expect(page.locator('.workspace-projects').getByRole('alert')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(header.getByRole('button', { name: 'Add project', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
  await expect(tree.getByRole('link', { name: projectName, exact: true })).toBeVisible()
  const tab = page.locator('.vc-site-tab')
  await expect(tab).toHaveCSS('border-top-width', '0px')
  await expect(tab).toHaveCSS('border-bottom-left-radius', '8px')
  await expect(tab).toHaveCSS('border-bottom-width', '1px')
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
  await page.getByLabel('Add task in Open', { exact: true }).fill('Prepare launch')
  await page.getByLabel('Add task in Open', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Prepare launch', exact: true }).click()
  await dialog.getByLabel('Description', { exact: true }).fill('Coordinate @dev')
  await expect(dialog.getByRole('option', { name: /@dev/ })).toBeVisible()
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
  await expect(page.getByRole('button', { name: 'Publishing', exact: true })).toBeVisible()
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
    .locator('.workspace-calendar-table tbody tr')
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
  const authority = await (await page.request.get('/api/organization-admin?site=default')).json()
  const chapter = authority.site
  const chapterMembership = await page.request.post('/api/organization-admin', {
    headers: { Origin: new URL(baseURL!).origin },
    data: {
      action: 'membership',
      site: 'default',
      user: user.id,
      role: 'editor',
      active: true,
      expectedRevision: chapter.revision,
      operationKey: crypto.randomUUID(),
    },
  })
  expect(chapterMembership.ok(), await chapterMembership.text()).toBe(true)
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
