import { expect, test } from '@playwright/test'

test('staff issue and correct retained receipts with private PDF generation and disabled email', async ({
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
    name = `Fictional receipt ${token}`
  const create = async (path: string, values: Record<string, unknown>) => {
    const response = await page.request.post(path, {
      data: { site: 'default', operationKey: crypto.randomUUID(), ...values },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc
  }
  const contact = (
    await create('/api/crm/contacts', {
      action: 'create',
      profile: { kind: 'person', firstName: name },
      roles: ['donor'],
    })
  ).id
  const fund = (
    await create('/api/crm/finance', { action: 'create-fund', name: `Receipt fund ${token}` })
  ).id
  const gift = (
    await create('/api/crm/finance', {
      action: 'create-gift',
      constituent: contact,
      amount: { currency: 'USD', minorUnits: '2500' },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-10-24',
      allocations: [{ fund, currency: 'USD', minorUnits: '2500' }],
      reference: 'Fictional correspondence test',
      notes: '',
    })
  ).id
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('link', { name: 'Receipts and correspondence', exact: true })
    .click()
  const nav = page.getByRole('navigation', { name: 'Correspondence sections' })
  await nav.getByRole('button', { name: 'Manage templates', exact: true }).click()
  await page.getByRole('button', { name: 'Create correspondence template', exact: true }).click()
  await page.getByLabel('Template name', { exact: true }).fill(`Receipt ${token}`)
  await page
    .getByRole('combobox', { name: 'Template type', exact: true })
    .selectOption('gift-receipt')
  await page.getByLabel('Template subject', { exact: true }).fill('Receipt for {{recipient.name}}')
  await page
    .getByLabel('Template body', { exact: true })
    .fill('Dear {{recipient.name}},\nThank you for your recorded gift.\n{{giving.summary}}')
  await page.getByRole('button', { name: 'Save template version', exact: true }).click()
  await expect(
    page.getByRole('button', { name: `Open Receipt ${token}`, exact: true }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('link', { name: 'Donations', exact: true })
    .click()
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .getByRole('button', { name: '2026-10-24', exact: true })
    .click()
  await page.getByRole('link', { name: 'Prepare receipt or thank-you', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`receiptGift=${gift}`))
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Prepare correspondence', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Document template', exact: true })
    .selectOption({ label: `Receipt ${token} · gift-receipt · version 1` })
  await page.getByLabel('Issuer name', { exact: true }).fill('Fictional nonprofit')
  await page.getByLabel('Issuer address', { exact: true }).fill('123 Fictional Avenue')
  await page.getByLabel('Document date', { exact: true }).fill('2026-10-24')
  await expect(page.getByLabel('Recorded gift', { exact: true })).toHaveValue(gift)
  await page.getByRole('button', { name: 'Preview resolved document', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Resolved document preview' })).toContainText(
    'USD 25.00',
  )
  const issuance = page.waitForResponse(
    (response) =>
      response.url().includes('/api/crm/correspondence') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON().action === 'issue-document',
  )
  await page.getByRole('button', { name: 'Issue reviewed document', exact: true }).click()
  const issued = (await (await issuance).json()).doc.id
  await expect(
    page.getByText(
      'Email sending is unavailable or unconfigured for this record. Printing and private PDF downloads remain available.',
    ),
  ).toBeVisible()
  const printable = await page.request.get(
    `/api/crm/correspondence?site=default&document=${issued}&format=html`,
  )
  expect(printable.ok()).toBe(true)
  expect(await printable.text()).toContain('USD 25.00')
  // Only the explicitly isolated local Worker has this test scheduler credential.
  const tick = await page.request.post('/api/crm/jobs/tick', {
    headers: { authorization: 'Bearer local-crm-correspondence-job-token-20261024' },
  })
  expect(tick.ok(), await tick.text()).toBe(true)
  await page.getByRole('button', { name: 'Refresh PDF status', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Download private PDF', exact: true })).toBeVisible()
  const pdf = await page.request.get(
    `/api/crm/correspondence?site=default&document=${issued}&format=pdf`,
  )
  expect(pdf.ok()).toBe(true)
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
  await create('/api/crm/finance', {
    action: 'adjust-gift',
    id: gift,
    adjustment: 'refund',
    deltaMinor: '-500',
    reason: 'Fictional partial refund',
    expectedRevision: 1,
  })
  await nav.getByRole('button', { name: 'Issued documents', exact: true }).click()
  await page.getByRole('button', { name: `Prepare correction for ${issued}`, exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Document template', exact: true })
    .selectOption({ label: `Receipt ${token} · gift-receipt · version 1` })
  await page.getByLabel('Issuer name', { exact: true }).fill('Fictional nonprofit')
  await page.getByLabel('Issuer address', { exact: true }).fill('123 Fictional Avenue')
  await page.getByLabel('Recorded gift', { exact: true }).selectOption(gift)
  await page.getByRole('button', { name: 'Preview resolved document', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Resolved document preview' })).toContainText(
    `supersedes document ${issued}`,
  )
  await expect(page.getByRole('region', { name: 'Resolved document preview' })).toContainText(
    'USD 20.00',
  )
  const correctionResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/crm/correspondence') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON().action === 'issue-document',
  )
  await page.getByRole('button', { name: 'Issue reviewed document', exact: true }).click()
  const corrected = (await (await correctionResponse).json()).doc.id
  await expect(
    page.getByRole('button', { name: 'Prepare another document', exact: true }),
  ).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('link', { name: 'Receipts and correspondence', exact: true })
    .click()
  await page.getByRole('button', { name: `Open document ${corrected}`, exact: true }).click()
  await expect(page.getByRole('region', { name: 'Issued document', exact: true })).toContainText(
    `Corrects document ${issued}`,
  )
  const original = await page.request.get(`/api/crm/correspondence?site=default&document=${issued}`)
  expect((await original.json()).doc.body).toContain('USD 25.00')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})
