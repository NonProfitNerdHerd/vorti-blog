import { createBrowserUser } from '../helpers/browser-user'
import { test, expect } from '@playwright/test'

test('Overview inline description, permission avatars, progress and paginated deep-linked activity', async ({
  page,
}) => {
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const username = `overview-ui-${Date.now()}`
  const created = await createBrowserUser(page.request, {
    data: {
      username,
      email: `${username}@example.invalid`,
      password: 'overview-browser-password',
      role: 'editor',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  await page.request.post('/api/users/logout')
  await page.request.post('/api/users/login', {
    data: { username, password: 'overview-browser-password' },
  })
  await page.goto('/admin/collections/review-tasks')
  await page
    .getByRole('complementary', { name: 'Projects and boards' })
    .getByRole('link', { name: "Personal To-Do's", exact: true })
    .click()
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  const board = Number(new URL(page.url()).searchParams.get('board'))
  await expect(page.getByRole('heading', { name: 'About this board', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit board description', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Board description', exact: true })
    .fill('Plan and track our work here.')
  await page.route(`**/api/task-boards/${board}?*`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 503,
        json: { error: 'Description save temporarily unavailable.' },
      })
      await page.unroute(`**/api/task-boards/${board}?*`)
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Save description', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Description save temporarily unavailable' }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Board description', exact: true })).toHaveValue(
    'Plan and track our work here.',
  )
  await page.getByRole('button', { name: 'Save description', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Edit board description', exact: true }),
  ).toHaveText('Plan and track our work here.')
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Edit board description', exact: true }),
  ).toHaveText('Plan and track our work here.')
  await page.getByRole('button', { name: 'Board permissions', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Board permissions', exact: true })
  await expect(
    dialog.getByText('Project members inherit access. Administrators retain oversight.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(dialog.locator('.workspace-access-owner')).toContainText(`@${username}`)
  const avatar = dialog
    .locator('.workspace-access-avatars .workspace-person-avatar')
    .filter({ hasText: `@${username}` })
  await avatar.focus()
  await expect(avatar.getByRole('tooltip')).toHaveText(`@${username}`)
  await page.screenshot({ path: '.wrangler/board-permissions-desktop.png', fullPage: true })
  await dialog.getByText('Manage board members', { exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Add member', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const today = new Date(),
    iso = (offset: number) => {
      const date = new Date(today)
      date.setDate(date.getDate() + offset)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
  const tasks: number[] = []
  for (let i = 0; i < 8; i++) {
    const result = await page.request.post('/api/review-tasks?depth=0', {
      data: {
        title: `Overview work ${i}`,
        initialBoard: board,
        status: i === 0 ? 'done' : 'open',
        priority: 'normal',
        ...(i < 4 ? { dueDate: iso(i - 2) } : {}),
      },
    })
    expect(result.ok(), await result.text()).toBe(true)
    tasks.push((await result.json()).doc.id)
  }
  const comment = await page.request.post('/api/review-comments?depth=0', {
    data: { task: tasks[1], body: 'Review this activity deep link.' },
  })
  expect(comment.ok(), await comment.text()).toBe(true)
  const content = 'Board notes\n'
  const staged = await page.request.post('/api/task-workspace/files/stage', {
    data: { task: tasks[1], filename: 'overview-note.txt', size: Buffer.byteLength(content) },
  })
  expect(staged.ok(), await staged.text()).toBe(true)
  const file = await staged.json()
  const uploaded = await page.request.put(`/api/task-workspace/files/${file.id}/content`, {
    data: content,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  expect(uploaded.ok(), await uploaded.text()).toBe(true)
  await page.getByRole('button', { name: 'Refresh board', exact: true }).click()
  await expect(page.getByText('1 of 8 tasks completed', { exact: true })).toBeVisible()
  for (const kind of ['done', 'overdue', 'upcoming', 'remaining'])
    await expect(
      page.locator(`.workspace-progress-track .workspace-progress-${kind}`),
    ).toBeVisible()
  const heading = await page
      .getByRole('heading', { name: 'About this board', exact: true })
      .boundingBox(),
    gauge = await page.locator('.workspace-board-progress').boundingBox()
  expect(gauge!.x).toBeGreaterThan(heading!.x + heading!.width)
  expect(gauge!.width).toBeGreaterThan(600)
  const activity = page.locator('.workspace-board-activity')
  await expect(
    activity.getByRole('combobox', { name: 'Activity rows per page', exact: true }),
  ).toHaveValue('50')
  await expect(activity.getByRole('button', { name: 'Comment added', exact: true })).toBeVisible()
  await activity
    .getByRole('combobox', { name: 'Activity rows per page', exact: true })
    .selectOption('10')
  await expect(activity.locator('tbody tr')).toHaveCount(10)
  await activity.getByRole('button', { name: 'Next activity page', exact: true }).click()
  await expect(activity.locator('.workspace-activity-pagination')).toContainText('11–')
  await activity.getByRole('button', { name: 'Previous activity page', exact: true }).click()
  await activity.getByRole('button', { name: 'Comment added', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByRole('tab', { name: 'Comments', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('dialog').getByText('Review this activity deep link.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await activity
    .getByRole('button', { name: 'Attachment added: overview-note.txt', exact: true })
    .click()
  await expect(
    page.getByRole('dialog').getByRole('tab', { name: 'Attachments', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'overview-note.txt', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Show all attachments', exact: true }),
  ).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.screenshot({ path: '.wrangler/board-overview-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: '.wrangler/board-overview-mobile-dark.png', fullPage: true })
})
