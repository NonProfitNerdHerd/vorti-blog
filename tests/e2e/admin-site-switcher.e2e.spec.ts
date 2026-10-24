import { expect, test } from '@playwright/test'

let originalSite: string | null = null
test.afterEach(async ({ page, baseURL }) => {
  if (!originalSite) return
  const latest = await (await page.request.get('/api/organization-admin')).json()
  const restored = await page.request.post('/api/organization-admin', {
    headers: { Origin: new URL(baseURL!).origin, 'x-vorticause-site': originalSite },
    data: {
      action: 'context',
      site: originalSite,
      expectedRevision: latest.context.revision,
      operationKey: crypto.randomUUID(),
    },
  })
  expect(restored.ok(), await restored.text()).toBe(true)
})

test('one shared header selector opens scoped dashboards and preserves independent editors', async ({
  page,
  context,
}) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
    timeout: 120000,
  })
  expect(login.ok()).toBe(true)
  const result = await (await page.request.get('/api/organization-admin')).json()
  originalSite = result.context.site
  const child = result.sites.find(
    (site: { id: string; archived: number }) => site.id !== 'default' && !site.archived,
  )
  expect(child, 'Isolated fixture must have an authorized child').toBeTruthy()
  for (const path of [
    '/admin',
    '/admin/collections/posts',
    '/admin/crm',
    '/admin/collections/review-tasks',
    '/admin/collections/forms',
    '/admin/globals/site-settings?tab=SubSites',
  ]) {
    await page.goto(path + (path.includes('?') ? '&' : '?') + 'site=default')
    const selector = page.getByRole('combobox', { name: 'Current site', exact: true })
    await expect(selector).toHaveValue('default')
    await expect(page.getByRole('combobox', { name: /CRM site|Site to administer/ })).toHaveCount(0)
    const avatar = page.getByRole('link', { name: 'Account', exact: true })
    const [tabBox, avatarBox] = await Promise.all([selector.boundingBox(), avatar.boundingBox()])
    expect(tabBox!.x).toBeLessThan(avatarBox!.x)
    expect(Math.abs(tabBox!.y - avatarBox!.y)).toBeLessThan(55)
  }
  await page.goto('/admin/collections/posts/create?site=default')
  const chooser = page.getByRole('dialog', { name: 'Create a Post · Choose a template', exact: true })
  await chooser.getByRole('button', { name: /Blank/ }).click()
  await chooser.getByRole('button', { name: 'Create Post', exact: true }).click()
  const title = page.getByRole('textbox', { name: /^Title/ })
  await title.fill('Unsaved site switch regression')
  await page.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(child.id)
  const confirmation = page.getByRole('dialog').filter({ hasText: 'Open the selected site' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Stay on this page' }).click()
  await expect(title).toHaveValue('Unsaved site switch regression')
  await expect(page.getByRole('combobox', { name: 'Current site', exact: true })).toHaveValue(
    'default',
  )
  await page.route('**/api/organization-admin', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'context')
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Access changed' }),
      })
    else await route.continue()
  })
  await page.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(child.id)
  await confirmation.getByRole('button', { name: 'Switch site', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not switch sites' })).toBeVisible()
  await expect(title).toHaveValue('Unsaved site switch regression')
  await page.screenshot({ path: '.wrangler/header-site-failed-switch.png' })
  await page.unroute('**/api/organization-admin')
  await page.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(child.id)
  await confirmation.getByRole('button', { name: 'Switch site', exact: true }).click()
  await expect(page).toHaveURL(new RegExp('/admin\\?site=' + child.id + '$'))
  await expect(page.getByRole('combobox', { name: 'Current site', exact: true })).toHaveValue(
    child.id,
  )
  const countResponse = await page.request.get(
    '/api/posts/count?where[_status][equals]=published',
    {
      headers: { 'x-vorticause-site': child.id },
    },
  )
  expect(countResponse.ok()).toBe(true)
  const count = (await countResponse.json()).totalDocs
  await expect(
    page.getByRole('link', { name: new RegExp('Published posts\\s*' + count + '$') }),
  ).toBeVisible()
  await page.screenshot({ path: '.wrangler/header-site-desktop.png' })
  const other = await context.newPage()
  await other.goto('/admin/crm?site=default')
  await expect(other.getByRole('combobox', { name: 'Current site', exact: true })).toHaveValue(
    'default',
  )
  await page.getByRole('button', { name: 'Refresh Dashboard', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Current site', exact: true })).toHaveValue(
    child.id,
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('button.nav-toggler--is-open')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Current site', exact: true })).toBeVisible()
  const mobileTab = await page
    .getByRole('combobox', { name: 'Current site', exact: true })
    .boundingBox()
  expect(mobileTab!.x).toBeGreaterThanOrEqual(0)
  // Payload animates the desktop sidebar closed after its breakpoint changes.
  await expect.poll(async () => {
    const avatar = await page.getByRole('link', { name: 'Account', exact: true }).boundingBox()
    return avatar!.x + avatar!.width
  }).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.wrangler/header-site-mobile.png' })
  await other.close()
})
