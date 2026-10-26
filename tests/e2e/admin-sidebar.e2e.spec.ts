import { expect, test, type Page } from '@playwright/test'
import { crmNavigation } from '../helpers/crm-navigation'
async function showMenu(page: Page) {
  const content = page
    .locator('#nav-group-Content')
    .getByRole('button', { name: 'Content', includeHidden: true })
  await expect(content).toBeAttached()
  if ((await content.getAttribute('tabindex')) === '-1' || !(await content.isVisible()))
    await page.getByRole('button', { name: 'Open Menu', exact: true }).first().click()
  await expect(content).toBeVisible()
  await expect(content).toHaveAttribute('tabindex', '0')
}
test('admin sidebar starts collapsed, follows routes, resets on reload, and hosts CRM on desktop and mobile', async ({
  page,
}) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin?site=default')
  await showMenu(page)
  const nav = page.locator('.nav__wrap')
  const parentNames = async () =>
    nav
      .locator(':scope > .vorti-dashboard-link, :scope > .nav-group')
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          node.classList.contains('vorti-dashboard-link')
            ? node.textContent?.trim()
            : node.id.replace('nav-group-', ''),
        ),
      )
  expect(await parentNames()).toEqual([
    'Dashboard',
    'Workflows',
    'Tasks',
    'Content',
    'CRM',
    'Forms',
    'Site Design',
    'Admin',
  ])
  for (const toggle of await nav.locator('button[aria-expanded]').all())
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await nav.getByRole('button', { name: 'Forms', exact: true }).click()
  await nav.getByRole('button', { name: 'Content', exact: true }).click()
  await nav.getByRole('link', { name: 'Posts', exact: true }).click()
  await expect(page).toHaveURL(/collections\/posts/)
  await showMenu(page)
  await expect(nav.getByRole('button', { name: 'Forms', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(nav.getByRole('button', { name: 'Content', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.reload()
  await showMenu(page)
  await expect(nav.getByRole('button', { name: 'Content', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(nav.getByRole('button', { name: 'Forms', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await nav.getByRole('link', { name: 'CRM', exact: true }).click()
  await expect(page).toHaveURL(/view=overview.*site=default/)
  let crm = await crmNavigation(page)
  await expect(crm.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('.vc-crm-sidebar')).toHaveCount(0)
  await expect(
    page.getByRole('navigation', { name: 'CRM sections', includeHidden: true }),
  ).toHaveCount(1)
  await crm.getByRole('link', { name: 'Constituents', exact: true }).click()
  await expect(page).toHaveURL(/view=contacts/)
  await page.goBack()
  crm = await crmNavigation(page)
  await expect(crm.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.goForward()
  crm = await crmNavigation(page)
  await expect(crm.getByRole('link', { name: 'Constituents', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  crm = await crmNavigation(page)
  await crm.getByRole('link', { name: 'Donations', exact: true }).click()
  await expect(page).toHaveURL(/view=donations.*site=default/)
  await expect(page.getByRole('heading', { name: 'Donations', exact: true })).toBeVisible()
  await expect(
    page
      .locator('.nav__wrap')
      .getByRole('button', { name: 'Toggle CRM navigation', includeHidden: true }),
  ).toHaveAttribute('tabindex', '-1')
  await expect(page.locator('aside.nav')).not.toHaveClass(/nav--nav-open/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
})
