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
  const action = header.getByRole('button', { name: 'Add project', exact: true })
  await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(action).toHaveCSS('border-top-width', '0px')
  const headerBox = await header.boundingBox()
  const actionBox = await action.boundingBox()
  expect(actionBox!.x).toBeGreaterThan(headerBox!.x + headerBox!.width * 0.7)
  await header.getByRole('button', { name: 'Add project', exact: true }).click()
  const dialog = page.locator('.editor-dialog-layer')
  const projectName = `Newsletter planning and communications ${suffix}`
  await dialog.getByLabel('Name', { exact: true }).fill(projectName)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
  await expect(page.locator('.workspace-projects').getByRole('alert')).toHaveCount(0)
  const projectURL = page.url()
  await tree.getByRole('button', { name: `Add board to ${projectName}`, exact: true }).click()
  const boardName = `October newsletter editorial calendar ${suffix}`
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
  await expect(page.getByLabel('Show boards', { exact: true })).toHaveValue('all')
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
  await expect(dialog.getByLabel('Task title', { exact: true })).toBeVisible()
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
  const summaryRoute = '**/api/task-workspace/projects/*/boards*'
  await page.route(summaryRoute, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ errors: [{ message: 'Summary temporarily unavailable' }] }),
    }),
  )
  await page.reload()
  await expect(page.locator('.workspace-projects').getByRole('alert')).toContainText(
    'Summary temporarily unavailable',
  )
  await expect(page.locator('.project-board-tile')).toHaveCount(0)
  await page.unroute(summaryRoute)
  await page
    .locator('.workspace-projects')
    .getByRole('button', { name: 'Retry', exact: true })
    .click()
  await expect(tile).toBeVisible()
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
  await dialog.getByRole('tab', { name: 'Subtasks', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Saved')
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('tab', { name: 'Subtasks', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await dialog.getByRole('button', { name: 'Add subtask', exact: true }).click()
  await dialog.getByLabel('Task title', { exact: true }).fill('Check accessibility')
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Saved')
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
  await dialog.getByRole('tab', { name: 'Comments', exact: true }).click()
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

test('rapid entry stays responsive and task drafts autosave across anchored tabs', async ({
  page,
}) => {
  const suffix = Date.now()
  const boardResponse = await page.request.post('/api/task-boards', {
    data: { name: 'Task UX ' + suffix },
  })
  expect(boardResponse.ok()).toBe(true)
  const board = (await boardResponse.json()).doc
  await page.goto(
    '/admin/collections/review-tasks?workspace=boards&board=' + board.id + '&site=default',
  )
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.route('**/api/task-workspace/create*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.continue()
  })
  await page.evaluate(() => {
    const state = window as unknown as {
      taskEntryFeedback: { elapsed: number; cleared: boolean }[]
    }
    state.taskEntryFeedback = []
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key !== 'Enter' ||
          !(event.target instanceof HTMLInputElement) ||
          !event.target.getAttribute('aria-label')?.startsWith('Add ')
        )
          return
        const input = event.target,
          started = performance.now()
        requestAnimationFrame(() =>
          state.taskEntryFeedback.push({
            elapsed: performance.now() - started,
            cleared: input.value === '',
          }),
        )
      },
      true,
    )
  })
  const entry = page.getByLabel('Add task in Open', { exact: true })
  for (let index = 1; index <= 5; index++) {
    await entry.fill('Rapid ' + index + ' ' + suffix)
    await entry.press('Enter')
    await expect(entry).toHaveValue('')
  }
  const parent = 'Rapid 5 ' + suffix
  await expect(page.getByRole('button', { name: parent, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Expand subtasks for ' + parent, exact: true }).click()
  const childEntry = page.getByLabel('Add subtask to ' + parent, { exact: true })
  for (let index = 1; index <= 3; index++) {
    await childEntry.fill('Rapid child ' + index + ' ' + suffix)
    await childEntry.press('Enter')
    await expect(childEntry).toHaveValue('')
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { taskEntryFeedback: unknown[] }).taskEntryFeedback.length,
      ),
    )
    .toBe(8)
  const feedback = await page.evaluate(
    () =>
      (window as unknown as { taskEntryFeedback: { elapsed: number; cleared: boolean }[] })
        .taskEntryFeedback,
  )
  expect(feedback).toHaveLength(8)
  expect(feedback.every((item) => item.cleared && item.elapsed < 250)).toBe(true)
  console.log(
    JSON.stringify({
      taskEntryFeedbackMaxMs: Math.max(...feedback.map((item) => item.elapsed)),
      delayedCreationMs: 700,
    }),
  )
  await childEntry.fill('Preserve this unfinished child title')
  await expect(page.getByRole('button', { name: parent, exact: true })).toBeEnabled()
  await expect(childEntry).toHaveValue('Preserve this unfinished child title')
  await childEntry.fill('')
  await page.getByRole('button', { name: parent, exact: true }).click()
  const dialog = page.locator('.editor-dialog-layer').first()
  await expect(dialog.getByLabel('Task title', { exact: true })).toHaveValue(parent)
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toHaveCount(0)
  const top = (await dialog.locator('.editor-dialog-card').boundingBox())!.y
  await dialog.getByLabel('Description', { exact: true }).fill('Saved across tabs ' + suffix)
  await dialog.getByRole('tab', { name: 'Subtasks', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Saved')
  await expect(
    dialog.getByRole('button', { name: 'Rapid child 3 ' + suffix, exact: true }),
  ).toBeVisible()
  expect((await dialog.locator('.editor-dialog-card').boundingBox())!.y).toBe(top)
  await dialog.getByRole('button', { name: 'Rapid child 3 ' + suffix, exact: true }).click()
  await expect(dialog.getByLabel('Task title', { exact: true })).toHaveValue(
    'Rapid child 3 ' + suffix,
  )
  await expect(dialog.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await dialog.getByRole('button', { name: 'Open parent task', exact: true }).click()
  await expect(dialog.getByLabel('Task title', { exact: true })).toHaveValue(parent)
  await expect(dialog.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await dialog.getByRole('tab', { name: 'Details', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('tab', { name: 'Subtasks', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(dialog.getByRole('tab', { name: 'Dependencies', exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(dialog.getByRole('tab', { name: 'Details', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Task collaboration', exact: true }).click()
  const collaboration = page.locator('.editor-dialog-layer').last()
  await expect(collaboration).toContainText('Task details, comments, and subtasks are shared')
  await page.keyboard.press('Escape')
  await expect(page.locator('.editor-dialog-layer')).toHaveCount(1)
  await expect(
    dialog.getByRole('button', { name: 'Task collaboration', exact: true }),
  ).toBeFocused()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: parent, exact: true }).click()
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(
    'Saved across tabs ' + suffix,
  )
  await page.route('**/api/review-tasks/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary save failure' }),
      })
    else await route.continue()
  })
  await dialog.getByLabel('Description', { exact: true }).fill('Preserved failed draft')
  await expect(dialog.getByRole('alert')).toContainText('Temporary save failure')
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(
    'Preserved failed draft',
  )
  await page.unroute('**/api/review-tasks/*')
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Saved')
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: parent, exact: true }).click()
  await dialog.getByLabel('Description', { exact: true }).fill('Flush before closing ' + suffix)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: parent, exact: true }).click()
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(
    'Flush before closing ' + suffix,
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
})

test('timeline dates, board dependencies, combined time tracking and calendar display modes', async ({
  page,
}) => {
  const suffix = Date.now(),
    title = 'Scheduled task ' + suffix
  const board = (
    await (
      await page.request.post('/api/task-boards', { data: { name: 'Scheduling UX ' + suffix } })
    ).json()
  ).doc
  const task = (
    await (
      await page.request.post('/api/review-tasks', {
        data: {
          title,
          initialBoard: board.id,
          status: 'open',
          priority: 'normal',
          startDate: '2026-10-20T12:00:00Z',
          dueDate: '2026-10-23T12:00:00Z',
        },
      })
    ).json()
  ).doc
  const predecessor = (
    await (
      await page.request.post('/api/review-tasks', {
        data: {
          title: 'Predecessor ' + suffix,
          initialBoard: board.id,
          status: 'open',
          priority: 'normal',
          dueDate: '2026-10-19T12:00:00Z',
        },
      })
    ).json()
  ).doc
  for (const name of ['Tracked time A', 'Tracked time B']) {
    const fieldResponse = await page.request.post('/api/task-field-definitions', {
      data: { name, kind: 'time-tracking' },
    })
    expect(fieldResponse.ok()).toBe(true)
    const field = (await fieldResponse.json()).doc
    expect(
      (
        await page.request.post('/api/task-board-fields', {
          data: { board: board.id, field: field.id },
        })
      ).ok(),
    ).toBe(true)
  }
  await page.goto(
    '/admin/collections/review-tasks?workspace=boards&board=' + board.id + '&site=default',
  )
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await page.getByLabel('Range start', { exact: true }).fill('2026-10-19')
  await expect(page.getByLabel('Visible days').locator('option')).toHaveText([
    '7',
    '14',
    '28',
    '60',
    '90',
    '120',
    '180',
    '240',
    '365',
  ])
  const bar = page.getByRole('button', { name: 'Open or move ' + title, exact: true })
  const labelBounds = (await page.getByRole('button', { name: title, exact: true }).boundingBox())!
  const initialBarBounds = (await bar.boundingBox())!
  expect(
    Math.abs(
      labelBounds.y + labelBounds.height / 2 - initialBarBounds.y - initialBarBounds.height / 2,
    ),
  ).toBeLessThan(2)
  const addBounds = (await page
    .getByRole('button', { name: '＋ Add task', exact: true })
    .boundingBox())!
  const baselineBounds = (await page.getByLabel('Compare baseline', { exact: true }).boundingBox())!
  expect(
    Math.abs(addBounds.y + addBounds.height / 2 - baselineBounds.y - baselineBounds.height / 2),
  ).toBeLessThan(10)
  await bar.focus()
  await bar.press('ArrowRight')
  await expect
    .poll(async () =>
      (
        await (await page.request.get('/api/review-tasks/' + task.id + '?depth=0')).json()
      ).startDate.slice(0, 10),
    )
    .toBe('2026-10-21')
  await expect(
    page.getByRole('button', { name: 'Resize end of ' + title, exact: true }),
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'Resize end of ' + title, exact: true })
    .press('ArrowRight')
  await expect
    .poll(async () =>
      (
        await (await page.request.get('/api/review-tasks/' + task.id + '?depth=0')).json()
      ).dueDate.slice(0, 10),
    )
    .toBe('2026-10-25')
  await expect(
    page.getByRole('button', { name: 'Resize end of ' + title, exact: true }),
  ).toBeEnabled()
  const barBounds = (await bar.boundingBox())!
  await page.mouse.move(barBounds.x + barBounds.width / 2, barBounds.y + barBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    barBounds.x + barBounds.width / 2 + 24,
    barBounds.y + barBounds.height / 2,
    { steps: 4 },
  )
  await page.mouse.up()
  await expect(page.locator('.editor-dialog-layer')).toHaveCount(0)
  await expect
    .poll(async () =>
      (
        await (await page.request.get('/api/review-tasks/' + task.id + '?depth=0')).json()
      ).startDate.slice(0, 10),
    )
    .toBe('2026-10-22')
  const initialWrites: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/api/review-tasks/'))
      initialWrites.push(request.url())
  })
  await bar.click()
  const dialog = page.locator('.editor-dialog-layer').first()
  await page.waitForTimeout(750) // Opening a task must remain read-only beyond the debounce interval.
  expect(initialWrites).toHaveLength(0)
  await expect(dialog.getByRole('tab', { name: 'Tracked Time', exact: true })).toHaveCount(1)
  await dialog.getByRole('tab', { name: 'Dependencies', exact: true }).click()
  await dialog
    .getByLabel('Find a task on this board', { exact: true })
    .fill('Predecessor ' + suffix)
  await dialog.getByLabel('Predecessor', { exact: true }).selectOption(String(predecessor.id))
  await dialog.getByRole('button', { name: 'Add finish-to-start dependency', exact: true }).click()
  await expect(
    dialog.getByRole('listitem').filter({ hasText: 'Predecessor ' + suffix }),
  ).toBeVisible()
  await dialog.getByRole('tab', { name: 'Tracked Time', exact: true }).click()
  await dialog.getByRole('button', { name: 'Start time for ' + title, exact: true }).click()
  await dialog.getByRole('button', { name: 'Pause time for ' + title, exact: true }).click()
  await expect(dialog.locator('.workspace-time-dialog tbody tr')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Change history', exact: true }).click()
  await expect(dialog.locator('.workspace-time-dialog table')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.reload()
  await page.getByLabel('Range start', { exact: true }).fill('2026-10-19')
  await expect(page.locator('.workspace-dependency-lines path')).toHaveCount(2)
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await page.getByLabel('Calendar date', { exact: true }).fill('2026-10-21')
  await page.getByLabel('Show tasks by', { exact: true }).selectOption('open')
  await expect(page.locator('.workspace-calendar-bubble').filter({ hasText: title })).toHaveCount(5)
  await page.getByLabel('Show tasks by', { exact: true }).selectOption('due')
  await expect(page.locator('.workspace-calendar-bubble').filter({ hasText: title })).toHaveCount(1)
  await page.getByLabel('Show tasks by', { exact: true }).selectOption('created')
  await page.reload()
  await expect(page.getByLabel('Show tasks by', { exact: true })).toHaveValue('created')
})
