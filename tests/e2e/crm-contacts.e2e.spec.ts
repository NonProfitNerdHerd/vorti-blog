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
  await page.goto('/admin/crm?view=contacts&site=default')
  await expect(page.getByRole('heading', { name: 'VortiCause', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New contact' }).click()
  const dialog = page.locator('.vc-crm-detail')
  await dialog.getByLabel('First name', { exact: true }).fill(browserFirstName)
  await dialog.getByLabel('Last name', { exact: true }).fill('Contact')
  await dialog.getByRole('checkbox', { name: 'donor', exact: true }).check()
  await dialog.getByRole('button', { name: 'Save contact' }).click()
  await expect(dialog.getByRole('heading', { name: browserContact, exact: true })).toBeVisible()
  await dialog.getByRole('tab', { name: 'Information', exact: true }).click()
  await dialog.getByRole('button', { name: 'Edit identity' }).click()
  await expect(dialog.getByRole('dialog', { name: 'Edit identity' })).toBeVisible()
  await dialog.getByLabel('Preferred name').fill('Browser review')
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /Confirm this update to the shared contact profile/ }).check()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await page.reload()
  await dialog.getByRole('button', { name: 'Edit identity' }).click()
  await expect(dialog.getByLabel('Preferred name')).toHaveValue('Browser review')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await dialog.getByRole('button', { name: 'Chapter', exact: true }).click()
  await dialog.getByRole('button', { name: 'Edit chapter details' }).click()
  await expect(dialog.getByRole('dialog', { name: 'Chapter details' })).toBeVisible()
  await dialog.getByLabel('Tags, separated by commas').fill('Local supporter, Browser review')
  await dialog.getByRole('button', { name: 'Save chapter details', exact: true }).click()
  await expect(dialog.getByText('Local supporter, Browser review')).toBeVisible()
  await dialog.getByRole('button', { name: 'Back to contacts' }).click()
  await page.getByRole('searchbox').fill('No contact matches this search')
  await expect(page.getByText('No contacts match this view.')).toBeVisible()
})

test('contact tabs remain usable across desktop and narrower workspace widths', async ({ page }) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/crm?view=contacts&site=default')
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  const detail = page.locator('.vc-crm-detail')
  const tabs = [
    ['Activity', 'Contact timeline'], ['Information', 'Shared profile'], ['Comments', 'Comments'],
    ['Tasks', 'Follow-up tasks'], ['Gifts', 'Chapter gifts'],
    ['Pledges and recurring', 'Pledges and recurring giving'], ['Memberships', 'Memberships'],
    ['Opportunities', 'Opportunities'], ['Volunteers', 'Volunteers'],
    ['Receipts and Correspondence', 'Receipts and correspondence'],
  ] as const
  for (const width of [1440, 820]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.vc-crm.vc-crm-detail-open')).toHaveCount(1)
    const contentWidth = await page.locator('.vc-crm-main').evaluate(element => element.getBoundingClientRect().width)
    const detailWidth = await detail.evaluate(element => element.getBoundingClientRect().width)
    expect(detailWidth).toBeGreaterThan(contentWidth - 100)
    const primaryWidth = await page.locator('.nav').evaluate(element => element.getBoundingClientRect().width)
    const secondary = page.locator('.vorti-secondary')
    const secondaryWidth = await secondary.count()
      ? await secondary.evaluate(element => element.getBoundingClientRect().width) : null
    for (const [label, heading] of tabs) {
      const tab = detail.getByRole('tab', { name: label, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      const selectedStyle = await tab.evaluate(element => {
        const style = getComputedStyle(element)
        return { shadow: style.boxShadow, background: style.backgroundColor }
      })
      expect(selectedStyle.shadow).not.toBe('none')
      expect(selectedStyle.background).not.toBe('rgba(0, 0, 0, 0)')
      await expect(detail.getByRole('tabpanel').getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
      if (['Activity', 'Information', 'Comments', 'Receipts and Correspondence'].includes(label))
        await page.screenshot({ path: `test-results/contact-${width}-${label.toLowerCase().replaceAll(/[^a-z]+/g, '-')}.png` })
      await expect.poll(() => page.locator('.nav').evaluate(element => element.getBoundingClientRect().width)).toBe(primaryWidth)
      if (secondaryWidth !== null)
        await expect.poll(() => secondary.evaluate(element => element.getBoundingClientRect().width)).toBe(secondaryWidth)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('a reader requests a correction without editing shared identity', async ({ page }) => {
  const login = await page.request.post('/api/users/login', {
    timeout: 120000,
    data: { email: 'crm-reader@example.invalid', password: 'crm-local-review-only' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/crm?view=contacts&site=default')
  await expect(page.getByRole('button', { name: 'New contact' })).toHaveCount(0)
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  const dialog = page.locator('.vc-crm-detail')
  await dialog.getByRole('tab', { name: 'Information', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Edit identity' })).toHaveCount(0)
  await dialog
    .getByLabel('Request a correction')
    .fill('Fictional correction request from browser test.')
  await dialog.getByRole('button', { name: 'Request correction', exact: true }).click()
  await expect(dialog).toBeVisible()
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
  await page.goto('/admin/crm?view=contacts&site=default')
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  const dialog = page.locator('.vc-crm-detail')
  await dialog.getByRole('tab', { name: 'Information', exact: true }).click()
  await dialog.getByRole('button', { name: 'Corrections', exact: true }).click()
  const row = dialog
    .getByRole('row')
    .filter({ hasText: 'Fictional correction request from browser test.' })
  await row.getByRole('button', { name: 'Review request', exact: true }).click()
  await dialog
    .getByLabel('Review reason')
    .fill('Verified fictional contact details in local review.')
  await dialog.getByRole('button', { name: 'Save review', exact: true }).click()
  await expect(row.getByRole('cell', { name: 'resolved', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(dialog.getByText('Browser review', { exact: true })).toBeVisible()
  await page.route('**/api/crm/context*', (route) =>
    route.fulfill({
      status: 403,
      json: { message: 'This site is unavailable or your access changed.' },
    }),
  )
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog).toContainText('Your CRM access changed.')
  await expect(page.getByRole('button', { name: browserContact, exact: true })).toHaveCount(0)
})

test('staff record a gift, audit a refund and preserve the original amount after reload', async ({
  page,
}) => {
  const login = await page.request.post('/api/users/login', {
    timeout: 120000,
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBe(true)
  await page.goto('/admin/crm?view=contacts&site=default')
  await page.getByRole('button', { name: browserContact, exact: true }).click()
  const dialog = page.locator('.vc-crm-detail')
  await dialog.getByRole('tab', { name: 'Gifts', exact: true }).click()
  await dialog.getByRole('button', { name: 'Record gift', exact: true }).click()
  const fundName = 'Fictional Browser Fund ' + Date.now()
  await dialog.getByLabel('New fund name', { exact: true }).fill(fundName)
  await dialog.getByRole('button', { name: 'Create fund', exact: true }).click()
  await dialog
    .getByRole('combobox', { name: 'Fund', exact: true })
    .selectOption({ label: fundName })
  await dialog.getByLabel('Amount', { exact: true }).fill('125.00')
  await dialog.getByLabel('Received on', { exact: true }).fill('2026-10-20')
  await dialog.getByLabel('Reference', { exact: true }).fill('Fictional browser donation')
  await dialog.getByRole('button', { name: 'Save gift', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Gift was recorded.')
  await dialog.getByRole('button', { name: '2026-10-20', exact: true }).click()
  await dialog.getByLabel('Signed amount (refunds are negative)', { exact: true }).fill('-25.00')
  await dialog.getByLabel('Reason', { exact: true }).fill('Fictional partial refund review')
  await dialog.getByRole('button', { name: 'Record adjustment', exact: true }).click()
  await expect(
    dialog.getByRole('row').filter({ hasText: 'Fictional partial refund review' }),
  ).toContainText('USD -25.00')
  await dialog.getByRole('button', { name: 'Close gift', exact: true }).click()
  await page.reload()
  const giftRow = dialog.getByRole('row').filter({ hasText: '2026-10-20' })
  await expect(giftRow).toContainText('USD 125.00')
  await expect(giftRow).toContainText('USD 100.00')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})
