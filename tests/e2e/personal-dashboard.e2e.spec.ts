import { createBrowserUser } from '../helpers/browser-user'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { localTaskDay, nextTaskDay } from '../../src/review/dashboard-model'
test.use({ actionTimeout: 20000 })

async function create(request: APIRequestContext, collection: string, data: object) {
  const response = collection === 'users' ? await createBrowserUser(request, {data: data as Record<string, unknown>}) : await request.post(`/api/${collection}`, { data })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json()).doc
}
test.beforeEach(async ({ page }) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBeTruthy()
})
test('Dashboard shows personal counts, ordered tasks, shared editing and filtered links', async ({
  page,
}) => {
  test.setTimeout(240000)
  const suffix = Date.now()
  const password = 'local-dashboard-test-password'
  const person = await create(page.request, 'users', { username: (`dashboard-${suffix}@example.invalid`).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(-32),
    email: `dashboard-${suffix}@example.invalid`,
    password,
    role: 'editor',
    displayName: 'Dashboard Tester',
    slug: `dashboard-tester-${suffix}`,
  })
  const document = await create(page.request, 'pages', {
    title: `Dashboard document ${suffix}`,
    slug: `dashboard-document-${suffix}`,
    _status: 'draft',
    contentLayout: { version: 1, nodes: [] },
  })
  const today = localTaskDay()
  const names = [
    'Overdue first',
    'Today next',
    'Due soon third',
    'Later fourth',
    'Undated fifth',
    'Undated sixth',
  ]
  for (const [index, title] of names.entries()) {
    await create(page.request, 'review-tasks', {
      title: `${title} ${suffix}`,
      documentType: 'pages',
      documentID: String(document.id),
      status: 'open',
      assignee: person.id,
      ...(index < 4
        ? { dueDate: `${nextTaskDay(today, [-1, 0, 7, 8][index])}T12:00:00.000Z` }
        : {}),
    })
  }
  await page.request.post('/api/users/login', { data: { email: person.email, password } })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: `Welcome back, ${person.username}` })).toBeVisible()
  const widget = page.getByRole('region', { name: 'My tasks', exact: true })
  await expect(widget.getByRole('listitem')).toHaveCount(5)
  await expect(widget.getByRole('listitem').nth(0)).toContainText(`Overdue first ${suffix}`)
  await expect(widget.getByRole('listitem').nth(1)).toContainText(`Today next ${suffix}`)
  await expect(widget.getByRole('listitem').nth(2)).toContainText(`Due soon third ${suffix}`)
  await expect(widget.getByRole('link', { name: '6 Unfinished' })).toBeVisible()
  await expect(widget.getByRole('link', { name: '1 Overdue' })).toBeVisible()
  await expect(widget.getByRole('link', { name: '2 Due soon' })).toBeVisible()
  await expect(page.getByRole('link', { name: /My unfinished tasks\s*6/ })).toBeVisible()
  const recent = page.getByRole('region', { name: 'Recently updated content' })
  await expect(recent.getByRole('link', { name: document.title })).toBeVisible()
  await widget.getByRole('button', { name: `Overdue first ${suffix}` }).click()
  const dialog = page.locator('.editor-dialog-layer')
  await dialog.getByLabel('Status', { exact: true }).selectOption('done')
  await expect(dialog.getByText('Saved', {exact: true})).toBeVisible()
  await expect(widget.getByRole('link', { name: '5 Unfinished' })).toBeVisible()
  await expect(page.getByRole('link', { name: /My unfinished tasks\s*5/ })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await widget.getByRole('link', { name: '2 Due soon' }).click()
  await expect(page.getByLabel('Assignee', { exact: true })).toHaveValue(String(person.id))
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('soon')
  await expect(page.getByText('2 tasks', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Assignee', { exact: true })).toHaveValue(String(person.id))
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('soon')
})
test('navigation order, administrator links, responsive Dashboard and keyboard focus', async ({
  page,
}) => {
  await page.goto('/admin')
  if (!(await page.locator('.nav').getAttribute('class'))?.includes('nav--nav-open'))
    await page.getByRole('button', { name: /^Open Menu$/i }).click()
  const nav = page.locator('.nav__wrap')
  for (const name of ['Dashboard', 'Tasks', 'CRM', 'Workflows'])
    await expect(nav.getByRole('link', {name, exact: true})).toBeVisible()
  const dashboardBox = await nav.getByRole('link', {name: 'Dashboard', exact: true}).boundingBox()
  const tasksBox = await nav.getByRole('link', {name: 'Tasks', exact: true}).boundingBox()
  const contentBox = await nav.getByRole('button', {name: 'Content', exact: true}).boundingBox()
  expect(tasksBox!.y).toBeGreaterThan(dashboardBox!.y)
  expect(contentBox!.y).toBeGreaterThan(tasksBox!.y)
  await expect(nav.locator('#nav-group-Review')).toHaveCount(0)
  await expect(nav.locator('#nav-group-Site')).toHaveCount(0)
  const admin = nav.locator('#nav-group-Admin')
  if ((await admin.getAttribute('class'))?.includes('nav-group--collapsed'))
    await admin.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(admin.getByRole('link', { name: 'Redirects', exact: true })).toHaveAttribute(
    'href',
    '/admin/collections/redirects',
  )
  await expect(admin.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
    'href',
    '/admin/globals/system-settings',
  )
  const design = nav.locator('[id="nav-group-Site Design"]')
  if ((await design.getAttribute('class'))?.includes('nav-group--collapsed'))
    await design.getByRole('button', { name: 'Site Design', exact: true }).click()
  await expect(design.getByRole('link', { name: 'Site Settings', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Close Menu$/i }).click()
  await page.getByRole('button', { name: 'Refresh Dashboard' }).focus()
  await expect(page.getByRole('button', { name: 'Refresh Dashboard' })).toBeFocused()
  await expect(page.locator('.vp-dashboard [role="status"]')).toHaveCount(0)
  await page.screenshot({
    animations: 'disabled',
    path: '.wrangler/dashboard-desktop.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '.wrangler/dashboard-mobile.png', fullPage: true })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await page.screenshot({ path: '.wrangler/dashboard-mobile-dark.png', fullPage: true })
})
