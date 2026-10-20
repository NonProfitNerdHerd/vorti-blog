import { expect, test } from '@playwright/test'

test.use({ actionTimeout: 20000 })
test.describe.configure({ mode: 'serial' })
const browserFirstName = 'Fictional Browser ' + Date.now()
const browserContact = browserFirstName + ' Contact'
test('CRM contact creation, validation and persisted shared-profile editing', async ({ page }) => {
  const login = await page.request.post('/api/users/login', {
    timeout: 120000,
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/crm')
  await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New contact' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('First name', { exact: true }).fill(browserFirstName)
  await dialog.getByLabel('Last name', { exact: true }).fill('Contact')
  await dialog.getByRole('checkbox', { name: 'donor', exact: true }).check()
  await dialog.getByRole('button', { name: 'Save contact' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  await dialog.getByLabel('Preferred name').fill('Browser review')
  await expect(dialog.getByRole('button', { name: 'Save contact' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /updates the shared contact profile/ }).check()
  await dialog.getByRole('button', { name: 'Save contact' }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  await expect(dialog.getByLabel('Preferred name')).toHaveValue('Browser review')
  await dialog.getByRole('tab', { name: 'Chapter details', exact: true }).click()
  await dialog.getByLabel('Tags, separated by commas').fill('Local supporter, Browser review')
  await dialog.getByRole('button', { name: 'Save chapter details', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  await dialog.getByRole('tab', { name: 'Chapter details', exact: true }).click()
  await expect(dialog.getByLabel('Tags, separated by commas')).toHaveValue(
    'Local supporter, Browser review',
  )
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('searchbox').fill('No contact matches this search')
  await expect(page.getByText('No contacts match this view.')).toBeVisible()
})

test('a reader requests a correction without editing shared identity', async ({ page }) => {
  const login = await page.request.post('/api/users/login', {
    timeout: 120000,
    data: { email: 'crm-reader@example.invalid', password: 'crm-local-review-only' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/crm')
  await expect(page.getByRole('button', { name: 'New contact' })).toHaveCount(0)
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('First name', { exact: true })).toBeDisabled()
  await dialog
    .getByLabel('Request a correction')
    .fill('Fictional correction request from browser test.')
  await dialog.getByRole('button', { name: 'Request correction', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.vc-crm-success')).toContainText('Correction request submitted.')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})

test('an authorized reviewer resolves a correction without rewriting the profile', async ({
  page,
}) => {
  const login = await page.request.post('/api/users/login', {
    timeout: 120000,
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/crm')
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'Corrections', exact: true }).click()
  const row = dialog
    .getByRole('row')
    .filter({ hasText: 'Fictional correction request from browser test.' })
  await row.getByRole('button', { name: 'Review request', exact: true }).click()
  await dialog
    .getByLabel('Review reason')
    .fill('Verified fictional contact details in local review.')
  await dialog.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(row.getByRole('cell', { name: 'resolved', exact: true })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Shared profile', exact: true }).click()
  await expect(dialog.getByLabel('Preferred name')).toHaveValue('Browser review')
  await page.route('**/api/crm/context', (route) =>
    route.fulfill({
      status: 403,
      json: { message: 'This site is unavailable or your access changed.' },
    }),
  )
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: browserContact, exact: true })).toHaveCount(0)
})
