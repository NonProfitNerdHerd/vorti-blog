import { expect, type Page } from '@playwright/test'

/** Use the actual far-left menu, including its mobile hamburger. */
export async function crmNavigation(page: Page) {
  const group = page.locator('#nav-group-CRM')
  await expect(group).toBeAttached()
  const toggle = group.getByRole('button', { name: 'Toggle CRM navigation', includeHidden: true })
  if (!(await toggle.isVisible()))
    await page.getByRole('button', { name: 'Open Menu', exact: true }).first().click()
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const navigation = group.getByRole('navigation', { name: 'CRM sections' })
  await expect(navigation).toBeVisible()
  return navigation
}
