import { expect, test } from '@playwright/test'
test('staff overview, chapter donations and direct constituent links persist across reload and mobile', async ({
  page,
}) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
        timeout: 120000,
      })
    ).ok(),
  ).toBe(true)
  const name = `Fictional overview donor ${Date.now()}`
  const post = async (path: string, values: Record<string, unknown>) => {
    const response = await page.request.post(`/api/crm/${path}`, {
      data: { site: 'default', operationKey: crypto.randomUUID(), ...values },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc as { id: string }
  }
  const contact = await post('contacts', {
    action: 'create',
    profile: { kind: 'person', firstName: name },
    roles: ['donor', 'volunteer'],
  })
  const fund = await post('finance', {
    action: 'create-fund',
    name: `Fictional overview fund ${Date.now()}`,
  })
  await page.goto('/admin/crm?site=default', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('region', { name: 'CRM overview' })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('link', { name: 'Donations', exact: true })
    .click()
  await expect(page).toHaveURL(/view=donations/)
  await page.getByRole('button', { name: 'Record gift', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search donor' }).fill(name)
  await page.getByRole('combobox', { name: 'Donor', exact: true }).selectOption(contact.id)
  await page.getByLabel('Amount', { exact: true }).fill('23.45')
  await page.getByLabel('Received on', { exact: true }).fill('2026-10-25')
  await page.getByRole('combobox', { name: 'Fund', exact: true }).selectOption(fund.id)
  await page.getByRole('button', { name: 'Save gift', exact: true }).click()
  await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Donations', exact: true })).toBeVisible()
  await page.getByRole('link', { name, exact: true }).first().click()
  await expect(page).toHaveURL(new RegExp(`contact=${contact.id}`))
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View or record gifts', exact: true }).click()
  await expect(page).toHaveURL(/contactTab=gifts/)
  await expect(page.getByRole('tab', { name: 'Gifts', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Gifts', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('dialog').getByText('USD 23.45').first()).toBeVisible()
  await page.getByRole('button', { name: 'Close contact', exact: true }).click()
  await expect(page).not.toHaveURL(/contact=/)
  await expect(page).not.toHaveURL(/contactTab=/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('link', { name: 'Overview', exact: true })
    .click()
  await expect(page.getByRole('region', { name: 'CRM overview' })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
})
