import { expect, type Page } from '@playwright/test'

/** Use the actual far-left menu, including its mobile hamburger. */
export async function crmNavigation(page: Page) {
  const group = page.locator('#nav-group-CRM')
  await expect(group).toBeAttached()
  const toggle = group.getByRole('button', { name: 'Toggle CRM navigation', includeHidden: true })
  if ((await toggle.getAttribute('tabindex')) === '-1' || !(await toggle.isVisible()))
    await page
      .getByRole('button', { name: 'Open Menu', exact: true })
      .filter({ visible: true })
      .first()
      .click()
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('tabindex', '0')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const navigation = group.getByRole('navigation', { name: 'CRM sections' })
  await expect(navigation).toBeVisible()
  return navigation
}
