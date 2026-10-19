import { expect, test } from '@playwright/test'

test('project hierarchy, every board view, rich page, messages, protected files and popup tabs', async ({
  page,
}) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBe(true)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const suffix = Date.now()
  const create = async (collection: string, data: object) => {
    const response = await page.request.post(`/api/${collection}`, { data })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc
  }
  const project = await create('task-projects', { name: `Work ${suffix}`, visibility: 'private' })
  const board = await create('task-boards', {
    name: `Personal to-dos ${suffix}`,
    project: project.id,
    inheritProject: true,
  })
  const task = await create('review-tasks', {
    title: `Schedule dentist ${suffix}`,
    initialBoard: board.id,
    dueDate: '2026-10-20T12:00:00.000Z',
  })
  await create('review-tasks', { title: 'Confirm appointment', parent: task.id })
  for (const kind of ['gantt', 'dashboard', 'page', 'messages', 'embed', 'workload', 'timesheets'])
    await create('task-views', {
      board: board.id,
      name: kind[0].toUpperCase() + kind.slice(1),
      kind,
    })
  await page.goto(`/admin/collections/review-tasks?workspace=boards&board=${board.id}`)
  await expect(page.getByRole('heading', { name: board.name, exact: true })).toBeVisible()
  const tabs = page.getByRole('navigation', { name: 'Board views', exact: true })
  for (const view of [
    'Overview',
    'List',
    'Board',
    'Calendar',
    'Timeline',
    'Gantt',
    'Dashboard',
    'Files',
    'Page',
    'Messages',
    'Embed',
    'Workload',
    'Timesheets',
  ]) {
    await tabs.getByRole('button', { name: view, exact: true }).click()
    await expect(tabs.getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.locator('.workspace-board')).toBeVisible()
    await expect(page.locator('.workspace-board [role="alert"]')).toHaveCount(0)
    if (view === 'Page') {
      const editor = page.locator('.workspace-page [contenteditable="true"]').first()
      await editor.fill('A saved project plan with rich text.')
      await page.getByRole('button', { name: 'Save page', exact: true }).click()
      await expect(page.getByText('Page saved.', { exact: true })).toBeVisible()
    }
  }
  await tabs.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('button', { name: task.title, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Task details', exact: true })
  await expect(dialog.getByRole('tab', { name: 'Default', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await dialog.getByRole('tab', { name: 'Comment Log', exact: true }).click()
  await dialog
    .getByLabel('Add comment', { exact: true })
    .fill('Keep the appointment confirmation here.')
  await dialog.getByRole('button', { name: 'Post comment', exact: true }).click()
  await expect(dialog.getByLabel('Add comment', { exact: true })).toHaveValue('')
  await dialog.getByRole('tab', { name: 'Attachments', exact: true }).click()
  await dialog
    .getByRole('tabpanel', { name: 'Attachments', exact: true })
    .locator('input[type=file]')
    .setInputFiles({
      name: 'confirmation.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Appointment confirmation'),
    })
  await expect(dialog.getByRole('link', { name: 'confirmation.txt', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await tabs.getByRole('button', { name: 'Files', exact: true }).click()
  await expect(page.getByRole('link', { name: 'confirmation.txt', exact: true })).toBeVisible()
  await page.screenshot({ path: '.wrangler/projects-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: '.wrangler/projects-mobile-dark.png', fullPage: true })
  expect(errors).toEqual([])
})
