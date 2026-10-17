import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBeTruthy()
})

test('review tasks stay separate from unsaved content and navigate globally', async ({ page }) => {
  const slug = `review-browser-${Date.now()}`
  const taskTitle = `Review mobile spacing ${slug}`
  const created = await page.request.post('/api/pages', {
    data: {
      title: 'Review browser',
      slug,
      _status: 'draft',
      contentLayout: {
        version: 1,
        nodes: [{ id: 'review-p', kind: 'paragraph', text: 'Saved paragraph' }],
      },
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { doc } = await created.json()
  await page.goto(`/admin/collections/pages/${doc.id}`)
  await expect(page.locator('.builder-frame')).toHaveAttribute('data-integrated', 'true')
  const text = page.locator('textarea.content-workspace__inline').first()
  await text.fill('Unsaved paragraph')
  await page.getByRole('button', { name: /^Tasks \(/ }).click()
  const panel = page.getByRole('complementary', { name: 'Document tasks' })
  await panel.getByRole('button', { name: 'Add task', exact: true }).click()
  const taskDialog = page.locator('.editor-dialog-layer')
  await expect(taskDialog).toHaveAttribute('aria-modal', 'true')
  await expect(page.locator('.block-actions__toolbar')).toBeHidden()
  await taskDialog.getByLabel('Task title', { exact: true }).fill(taskTitle)
  await taskDialog.getByLabel('Task title', { exact: true }).press('Enter')
  await expect(taskDialog.getByRole('heading', { name: 'New task', exact: true })).toBeVisible()
  await taskDialog.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(taskDialog.getByRole('heading', { name: 'Task details' })).toBeVisible()
  await page.screenshot({ path: '.wrangler/task-dialog-desktop.png' })
  await expect(page.getByRole('button', { name: 'Tasks (1)', exact: true })).toBeVisible()
  await taskDialog
    .getByLabel('Add comment', { exact: true })
    .fill('Please inspect https://example.com and <script> safely.')
  await taskDialog.getByRole('button', { name: 'Post comment' }).click()
  await expect(taskDialog.getByRole('link', { name: 'https://example.com' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  )
  await taskDialog.getByRole('button', { name: 'Add subtask', exact: true }).click()
  await taskDialog.getByLabel('Task title', { exact: true }).fill('Check Phone preview')
  await taskDialog.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Tasks (2)', exact: true })).toBeVisible()
  await taskDialog.getByRole('button', { name: 'Open parent task' }).click()
  await expect(taskDialog.getByLabel('Task title', { exact: true })).toHaveValue(taskTitle)
  await taskDialog.getByLabel('Status', { exact: true }).selectOption('done')
  await taskDialog.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(taskDialog.getByRole('alert')).toContainText('Complete all subtasks')
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)
  await expect(panel).toBeVisible()
  const row = panel.getByRole('button', { name: taskTitle, exact: true })
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await row.click()
  await expect(taskDialog.getByLabel('Task title', { exact: true })).toHaveValue(taskTitle)
  await taskDialog.getByRole('button', { name: 'Close dialog' }).click()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: /^Tasks \(/ })).toBeFocused()
  await expect(text).toHaveValue('Unsaved paragraph')
  const saved = await (await page.request.get(`/api/pages/${doc.id}?depth=0`)).json()
  expect(saved.contentLayout.nodes[0].text).toBe('Saved paragraph')
  expect(saved._status).toBe('draft')
  await page.screenshot({ path: '.wrangler/review-editor.png' })
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/admin/collections/review-tasks')
  await page.getByLabel('Search tasks').fill(taskTitle)
  await page.getByRole('button', { name: taskTitle, exact: true }).click()
  await page.getByRole('button', { name: 'Open document', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/pages/${doc.id}\\?task=`))
  await expect(page.getByRole('complementary', { name: 'Document tasks' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({ path: '.wrangler/review-mobile.png' })
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Document tasks' })).toBeHidden()
})

test('new documents explain why tasks need a saved document', async ({ page }) => {
  await page.goto('/admin/collections/pages/create')
  await page.getByRole('button', { name: 'Tasks (0)', exact: true }).click()
  await expect(page.getByText('Save this document before adding tasks.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Tasks (0)', exact: true })).toBeFocused()
})

test('task entry works in every editor and Site Template region links', async ({ page }) => {
  for (const collection of ['posts', 'design-templates', 'site-templates']) {
    const { user } = await (await page.request.get('/api/users/me')).json()
    const slug = `task-context-${collection}-${Date.now()}`
    const response = await page.request.post(`/api/${collection}`, {
      data: {
        [collection === 'posts' ? 'title' : 'name']: slug,
        slug,
        _status: 'draft',
        ...(collection === 'posts' ? { author: user.id } : {}),
        ...(collection === 'design-templates' ? { layout: [], allowedCollections: ['posts'] } : {}),
      },
    })
    expect(response.ok(), `${collection}: ${await response.text()}`).toBeTruthy()
    const { doc } = await response.json()
    const taskResponse = await page.request.post('/api/review-tasks', {
      data: {
        title: `Review ${collection}`,
        documentType: collection,
        documentID: String(doc.id),
        region: collection === 'site-templates' ? 'footer' : 'document',
      },
    })
    expect(taskResponse.ok(), await taskResponse.text()).toBeTruthy()
    const { doc: task } = await taskResponse.json()
    await page.goto(
      `/admin/collections/${collection}/${doc.id}?task=${task.id}${collection === 'site-templates' ? '&reviewRegion=footer' : ''}`,
    )
    await expect(page.getByRole('complementary', { name: 'Document tasks' })).toBeVisible()
    await expect(page.getByLabel('Task title', { exact: true })).toHaveValue(`Review ${collection}`)
    if (collection === 'site-templates')
      await expect(page.getByRole('tab', { name: 'Footer', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
  }
})
