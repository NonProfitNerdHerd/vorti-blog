import { expect, test, type Page } from '@playwright/test'

async function workflowNavigation(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Workflows sections' })
  if (!(await navigation.isVisible().catch(() => false))) {
    const drawer = page.getByRole('button', { name: 'Workflows menu' })
    if (await drawer.isVisible().catch(() => false)) await drawer.click()
    else await page.locator('#nav-group-Workflows').getByRole('link', { name: 'Workflows' }).hover()
  }
  await expect(navigation).toBeVisible()
  return navigation
}

test('Workflows sidebar, template catalogue, saved workflow and private shared copies', async ({
  page,
}) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
    timeout: 120000,
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/workflows?workflowView=create&site=default')
  await expect(page.getByRole('heading', { name: 'Create Workflows', exact: true })).toBeVisible()
  const nav = await workflowNavigation(page)
  await expect(nav.getByRole('link', { name: 'Create Workflows', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'My Workflows', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Shared Workflows', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build from scratch' })).toBeVisible()
  await page
    .getByRole('button', { name: 'Use template: Create a CRM contact manually', exact: true })
    .click()
  const name = `Workflow browser ${Date.now()}`
  await page.getByLabel('Name', { exact: true }).fill(name)
  await expect(page.getByText('1. Choose a trigger')).toBeVisible()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByRole('button', { name: 'Publish own draft', exact: true }).click()
  await expect(page.getByText(/Published version 1/)).toBeVisible()
  await page.getByRole('button', { name: 'Share published template', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop sharing template' })).toBeVisible()
  await (
    await workflowNavigation(page)
  )
    .getByRole('link', { name: 'My Workflows', exact: true })
    .click()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await (
    await workflowNavigation(page)
  )
    .getByRole('link', { name: 'Shared Workflows', exact: true })
    .click()
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Copy to My Workflows', exact: true }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(`${name} (copy)`)
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})
