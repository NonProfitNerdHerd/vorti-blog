import { crmNavigation } from '../helpers/crm-navigation'
import { expect, test } from '@playwright/test'
test('opportunity pipeline, explicit financial links and stage history persist in the chapter', async ({
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
  const token = Date.now().toString(),
    name = `Fictional opportunity ${token}`,
    proposal = `Proposal ${token}`
  const contactResponse = await page.request.post('/api/crm/contacts', {
    data: {
      action: 'create',
      site: 'default',
      profile: { kind: 'person', firstName: name },
      roles: ['donor'],
      operationKey: crypto.randomUUID(),
    },
  })
  expect(contactResponse.ok()).toBe(true)
  const contact = (await contactResponse.json()).doc.id
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await (
    await crmNavigation(page)
  )
    .getByRole('link', { name: 'Opportunities', exact: true })
    .click()
  await page.getByRole('button', { name: 'Create pipeline', exact: true }).click()
  await page.getByLabel('Pipeline name', { exact: true }).fill(`Major gifts ${token}`)
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Pipeline', exact: true })
    .selectOption({ label: `Major gifts ${token}` })
  await page.getByRole('button', { name: 'Create opportunity', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Opportunity editor' })
  await editor.getByLabel('Opportunity name').fill(proposal)
  await editor.getByRole('searchbox', { name: 'Search constituent', exact: true }).fill(name)
  await editor
    .getByRole('combobox', { name: 'Constituent', exact: true })
    .selectOption({ label: name })
  await editor.getByLabel('Expected amount (optional)').fill('125.00')
  await editor.getByLabel('Next action', { exact: true }).fill('Arrange meeting')
  await editor.getByLabel('Next action date').fill('2026-11-01')
  await editor.getByRole('button', { name: 'Save opportunity' }).click()
  await page.getByRole('button', { name: proposal, exact: true }).click()
  await expect(
    editor.getByRole('link', {
      name: 'Private record attachments (opens in another tab)',
      exact: true,
    }),
  ).toBeVisible()
  await editor
    .getByRole('combobox', { name: 'Opportunity stage', exact: true })
    .selectOption({ label: 'Received' })
  await editor
    .getByLabel('Stage change reason')
    .fill('Planning outcome; no received gift exists yet')
  await editor.getByRole('button', { name: 'Save opportunity' }).click()
  await page.getByRole('button', { name: 'Pipeline view', exact: true }).click()
  await page
    .getByRole('region', { name: 'Received stage', exact: true })
    .getByRole('button', { name: proposal, exact: true })
    .click()
  await expect(
    editor.getByText('Planning outcome; no received gift exists yet', { exact: true }),
  ).toBeVisible()
  expect(
    (await (await page.request.get(`/api/crm/finance?site=default&constituent=${contact}`)).json())
      .docs,
  ).toHaveLength(0)
  expect(
    (
      await (
        await page.request.get(`/api/crm/giving?site=default&kind=pledge&contact=${contact}`)
      ).json()
    ).docs,
  ).toHaveLength(0)
  const fundResponse = await page.request.post('/api/crm/finance', {
    data: {
      action: 'create-fund',
      site: 'default',
      name: `Opportunity fund ${token}`,
      operationKey: crypto.randomUUID(),
    },
  })
  expect(fundResponse.ok()).toBe(true)
  const fund = (await fundResponse.json()).doc.id
  const giftResponse = await page.request.post('/api/crm/finance', {
    data: {
      action: 'create-gift',
      site: 'default',
      constituent: contact,
      amount: { currency: 'USD', minorUnits: '12500' },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-10-24',
      allocations: [{ fund, currency: 'USD', minorUnits: '12500' }],
      reference: 'Fictional opportunity gift',
      notes: '',
      operationKey: crypto.randomUUID(),
    },
  })
  expect(giftResponse.ok()).toBe(true)
  await editor.getByRole('button', { name: 'Load recorded gifts', exact: true }).click()
  await expect(
    editor.getByRole('combobox', { name: 'Financial record', exact: true }).locator('option'),
  ).toHaveCount(2)
  await editor
    .getByRole('combobox', { name: 'Financial record', exact: true })
    .selectOption({ index: 1 })
  await editor.getByLabel('Financial link reason').fill('Explicitly link recorded gift')
  await editor.getByRole('button', { name: 'Link recorded record', exact: true }).click()
  await expect(editor.getByText(/Explicitly link recorded gift/)).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await (
    await crmNavigation(page)
  )
    .getByRole('link', { name: 'Opportunities', exact: true })
    .click()
  await page
    .getByRole('combobox', { name: 'Pipeline', exact: true })
    .selectOption({ label: `Major gifts ${token}` })
  await page.getByRole('button', { name: proposal, exact: true }).click()
  await expect(editor.getByText(/Explicitly link recorded gift/)).toBeVisible()
  await expect(editor.getByLabel('Expected amount (optional)')).toHaveValue('125.00')
  await editor.getByRole('button', { name: 'Close opportunity', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Pipeline view', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})
