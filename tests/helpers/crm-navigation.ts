import { expect, type Page } from '@playwright/test'

/** Open the shared CRM secondary sidebar on desktop or in the mobile drawer. */
export async function crmNavigation(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'CRM sections' })
  if (!(await navigation.isVisible().catch(() => false))) {
    const toggle = page.getByRole('button', { name: 'CRM menu' })
    if (await toggle.isVisible().catch(() => false)) await toggle.click()
    else await page.locator('#nav-group-CRM').getByRole('link', { name: 'CRM' }).hover()
  }
  await expect(navigation).toBeVisible()
  return navigation
}
