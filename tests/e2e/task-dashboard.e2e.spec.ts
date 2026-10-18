import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  defaultTaskFilters,
  localTaskDay,
  nextTaskDay,
  taskFiltersWhere,
  taskPresetFilters,
} from '../../src/review/dashboard-model'

test.beforeEach(async ({ page }) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBeTruthy()
})
async function create(request: APIRequestContext, collection: string, data: object) {
  const response = await request.post(`/api/${collection}`, { data })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).doc
}
async function count(request: APIRequestContext, where: object) {
  const response = await request.get(
    `/api/review-tasks/count?${new URLSearchParams({ where: JSON.stringify(where) })}`,
  )
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).totalDocs as number
}

test('task dashboard filters the table, counts all pages and opens documents in new tabs', async ({
  page,
}) => {
  test.setTimeout(240000)
  const { user } = await (await page.request.get('/api/users/me')).json()
  const prefix = `Dashboard ${Date.now()}`
  const today = localTaskDay()
  const document = await create(page.request, 'pages', {
    title: prefix,
    slug: `dashboard-${Date.now()}`,
    _status: 'draft',
    contentLayout: { version: 1, nodes: [] },
  })
  for (let index = 0; index < 14; index++) {
    await create(page.request, 'review-tasks', {
      title: `${prefix} ${String(index).padStart(2, '0')}`,
      documentType: 'pages',
      documentID: String(document.id),
      status:
        index === 12
          ? 'done'
          : index === 10
            ? 'in-progress'
            : index === 11
              ? 'ready-for-review'
              : 'open',
      archived: index === 13,
      assignee: index % 2 ? user.id : null,
      ...(index < 8
        ? {
            dueDate: `${nextTaskDay(today, index === 0 ? -1 : index === 1 ? 0 : index === 2 ? 7 : 8)}T12:00:00.000Z`,
          }
        : {}),
    })
  }
  await page.goto('/admin/collections/review-tasks?depth=1&limit=10')
  const dashboard = page.getByRole('region', { name: 'Task dashboard', exact: true })
  const expected = await count(page.request, taskFiltersWhere(defaultTaskFilters(), today))
  await expect(
    dashboard.getByRole('button', { name: `All unfinished: ${expected}`, exact: true }),
  ).toBeVisible()
  await expect(dashboard.getByLabel('Status', { exact: true })).toHaveValue('active')
  await dashboard.getByLabel('Search tasks', { exact: true }).fill(prefix)
  await expect(dashboard.getByRole('table').getByRole('row')).toHaveCount(11)
  await expect(dashboard.getByText('12 tasks', { exact: true })).toBeVisible()
  await expect(
    dashboard.getByRole('button', { name: `All unfinished: ${expected}`, exact: true }),
  ).toBeVisible()
  await dashboard.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(dashboard.getByRole('table').getByRole('row')).toHaveCount(3)
  await expect(page).toHaveURL(/page=2/)
  await page.reload()
  await expect(dashboard.getByLabel('Rows per page')).toHaveValue('10')
  await expect(dashboard.getByText(/Page 2 of/)).toBeVisible()
  await dashboard.getByLabel('Search tasks', { exact: true }).fill(prefix)
  await dashboard.getByLabel('Rows per page').selectOption('25')
  await expect(dashboard.getByRole('table').getByRole('row')).toHaveCount(13)
  await dashboard.getByLabel('Assignee', { exact: true }).selectOption('unassigned')
  await expect(dashboard.getByText('6 tasks', { exact: true })).toBeVisible()
  await dashboard.getByRole('button', { name: /^Assigned to me:/ }).click()
  await expect(dashboard.getByLabel('Search tasks', { exact: true })).toHaveValue('')
  await expect(dashboard.getByLabel('Assignee', { exact: true })).toHaveValue(String(user.id))
  const assigned = await count(
    page.request,
    taskFiltersWhere(taskPresetFilters('assigned', String(user.id)), today),
  )
  await expect(
    dashboard.getByRole('button', { name: `Assigned to me: ${assigned}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await dashboard.getByRole('button', { name: 'Reset', exact: true }).click()
  await dashboard.getByLabel('Search tasks', { exact: true }).fill(prefix)
  await dashboard.getByLabel('Due date', { exact: true }).selectOption('overdue')
  await expect(dashboard.getByText('1 task', { exact: true })).toBeVisible()
  await dashboard.getByLabel('Due date', { exact: true }).selectOption('today')
  await expect(dashboard.getByText('1 task', { exact: true })).toBeVisible()
  await dashboard.getByLabel('Due date', { exact: true }).selectOption('soon')
  await expect(dashboard.getByText('2 tasks', { exact: true })).toBeVisible()
  await dashboard.getByLabel('Due date', { exact: true }).selectOption('none')
  await expect(dashboard.getByText('4 tasks', { exact: true })).toBeVisible()
  await dashboard.getByLabel('Due date', { exact: true }).selectOption('')
  await dashboard.getByRole('button', { name: `${prefix} 00`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Task details', exact: true })
  await dialog.getByLabel('Status', { exact: true }).selectOption('done')
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(
    dashboard.getByRole('button', { name: `All unfinished: ${expected - 1}`, exact: true }),
  ).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dashboard.getByText('11 tasks', { exact: true })).toBeVisible()
  await dashboard.getByLabel('Search tasks', { exact: true }).fill('no-matching-dashboard-task')
  await expect(dashboard.getByText('No tasks match these filters.')).toBeVisible()
  await dashboard.getByRole('button', { name: 'Reset', exact: true }).click()
  await dashboard.getByLabel('Search tasks', { exact: true }).fill(prefix)
  await expect(dashboard.getByRole('button', { name: `${prefix} 01`, exact: true })).toBeVisible()
  await page.screenshot({ path: '.wrangler/task-dashboard-desktop.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({
    path: '.wrangler/task-dashboard-mobile-dark.png',
    animations: 'disabled',
  })
  const site = await create(page.request, 'site-templates', {
    name: `${prefix} Site`,
    slug: `dashboard-site-${Date.now()}`,
    _status: 'draft',
  })
  const footer = await create(page.request, 'review-tasks', {
    title: `${prefix} Footer link`,
    documentType: 'site-templates',
    documentID: String(site.id),
    region: 'footer',
  })
  await dashboard.getByLabel('Search tasks', { exact: true }).fill(footer.title)
  await expect(dashboard.getByRole('button', { name: footer.title, exact: true })).toBeVisible()
  await expect(dashboard.getByRole('link', { name: /^Open .* in new tab$/ })).toHaveCount(1)
  const popupPromise = page.waitForEvent('popup')
  await dashboard.getByRole('link', { name: /^Open .* in new tab$/ }).click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(
    new RegExp(`/site-templates/${site.id}\\?task=${footer.id}&reviewRegion=footer`),
  )
  await expect(popup.getByRole('tab', { name: 'Footer', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('.editor-dialog-layer')).toHaveCount(0)
  await popup.close()
})

test('task dashboard counts and links respect task access and retain deleted document history', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000)
  const suffix = Date.now()
  const editor = await create(page.request, 'users', { username: (`dashboard-editor-${suffix}@example.invalid`).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(-32),
    email: `dashboard-editor-${suffix}@example.invalid`,
    password: 'local-dashboard-editor-password',
    role: 'editor',
  })
  const privateDocument = await create(page.request, 'design-templates', {
    name: `Private ${suffix}`,
    slug: `private-${suffix}`,
    allowedCollections: ['pages'],
    layout: [],
    _status: 'draft',
  })
  const privateTask = await create(page.request, 'review-tasks', {
    title: `Private review ${suffix}`,
    documentType: 'design-templates',
    documentID: String(privateDocument.id),
  })
  const context = await browser.newContext()
  const editorPage = await context.newPage()
  const origin = new URL(test.info().project.use.baseURL!).origin
  const login = await context.request.post(`${origin}/api/users/login`, {
    data: { email: editor.email, password: 'local-dashboard-editor-password' },
  })
  expect(login.ok()).toBeTruthy()
  const editorCount = await context.request.get(
    `${origin}/api/review-tasks/count?${new URLSearchParams({ where: JSON.stringify(taskFiltersWhere(defaultTaskFilters(), localTaskDay())) })}`,
  )
  expect(editorCount.ok()).toBeTruthy()
  const editorTotal = (await editorCount.json()).totalDocs
  await editorPage.goto(`${origin}/admin/collections/review-tasks`)
  await expect(
    editorPage.getByRole('button', { name: `All unfinished: ${editorTotal}`, exact: true }),
  ).toBeVisible()
  await editorPage.getByLabel('Search tasks', { exact: true }).fill(privateTask.title)
  await expect(editorPage.getByText('No tasks match these filters.')).toBeVisible()
  const denied = await context.request.get(`${origin}/api/review-tasks/${privateTask.id}`)
  expect([403, 404]).toContain(denied.status())
  await context.close()
  const document = await create(page.request, 'pages', {
    title: `Deleted ${suffix}`,
    slug: `deleted-${suffix}`,
    _status: 'draft',
  })
  const task = await create(page.request, 'review-tasks', {
    title: `Orphaned ${suffix}`,
    documentType: 'pages',
    documentID: String(document.id),
  })
  const deleted = await page.request.delete(`/api/pages/${document.id}`)
  expect(deleted.ok(), await deleted.text()).toBeTruthy()
  await page.goto('/admin/collections/review-tasks')
  await page.getByLabel('Search tasks', { exact: true }).fill(task.title)
  await expect(
    page.getByRole('button', { name: 'Document unavailable', exact: true }),
  ).toBeDisabled()
  await expect(page.getByRole('button', { name: task.title, exact: true })).toBeVisible()
})
