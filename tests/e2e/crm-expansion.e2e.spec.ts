import { crmNavigation } from '../helpers/crm-navigation'
import { expect, test } from '@playwright/test'
test('household, relationship, communication and fundraising editors persist in the selected chapter', async ({
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
    contactName = `Fictional expansion ${token}`
  const contact = await page.request.post('/api/crm/contacts', {
    data: {
      action: 'create',
      site: 'default',
      profile: { kind: 'person', firstName: contactName },
      roles: ['donor'],
      operationKey: crypto.randomUUID(),
    },
  })
  expect(contact.ok()).toBe(true)
  const target = await page.request.post('/api/crm/contacts', {
    data: {
      action: 'create',
      site: 'default',
      profile: { kind: 'person', firstName: `Related ${token}` },
      roles: ['contact'],
      operationKey: crypto.randomUUID(),
    },
  })
  expect(target.ok()).toBe(true)
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await (await crmNavigation(page)).getByRole('link', { name: 'Households', exact: true }).click()
  await page.getByRole('button', { name: 'Create household', exact: true }).click()
  const household = page.getByRole('region', { name: 'Household editor' })
  await household.getByLabel('Name', { exact: true }).fill(`Household ${token}`)
  await household.getByLabel('Mailing address').fill('123 Fictional Lane')
  await household.getByRole('button', { name: 'Save household', exact: true }).click()
  await expect(
    household.getByRole('link', {
      name: 'Private record attachments (opens in another tab)',
      exact: true,
    }),
  ).toBeVisible()
  await household.getByRole('searchbox', { name: 'Search contact', exact: true }).fill(contactName)
  await household
    .getByRole('combobox', { name: 'Contact', exact: true })
    .selectOption({ label: contactName })
  await household.getByLabel('Member since').fill('2026-01-01')
  await household.getByRole('button', { name: 'Add member', exact: true }).click()
  await expect(household.getByRole('cell', { name: contactName, exact: true })).toBeVisible()
  await household.getByLabel('Primary contact').selectOption({ label: contactName })
  const [savedPrimary] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/crm/households' &&
        response.request().method() === 'POST',
    ),
    household.getByRole('button', { name: 'Save household', exact: true }).click(),
  ])
  expect(savedPrimary.ok()).toBe(true)
  await expect(household.getByRole('button', { name: 'Save household', exact: true })).toBeEnabled()
  await page.reload()
  await (await crmNavigation(page)).getByRole('link', { name: 'Households', exact: true }).click()
  await page.getByRole('button', { name: `Household ${token}`, exact: true }).click()
  await expect(household.getByLabel('Mailing address')).toHaveValue('123 Fictional Lane')
  await expect(household.getByLabel('Primary contact').locator('option:checked')).toHaveText(
    contactName,
  )
  await expect(household.getByRole('cell', { name: contactName, exact: true })).toBeVisible()
  await household.getByRole('button', { name: 'Close household' }).click()
  await (await crmNavigation(page)).getByRole('link', { name: 'Constituents', exact: true }).click()
  await page.getByRole('button', { name: contactName, exact: true }).click()
  const dialog = page.locator('.vc-crm-detail')
  await dialog.getByRole('tab', { name: 'Information', exact: true }).click()
  await dialog.getByRole('button', { name: 'Relationships', exact: true }).click()
  await dialog.getByText('Manage relationship types', { exact: true }).click()
  await dialog.getByLabel('Forward label').fill(`Employer ${token}`)
  await dialog.getByLabel('Reciprocal label').fill(`Employee ${token}`)
  await dialog.getByRole('button', { name: 'Save type', exact: true }).click()
  await expect(dialog.getByLabel('Forward label')).toHaveValue('')
  await dialog.getByRole('searchbox', { name: 'Search related contact' }).fill(`Related ${token}`)
  await dialog
    .getByRole('combobox', { name: 'Related contact', exact: true })
    .selectOption({ label: `Related ${token}` })
  await dialog
    .getByRole('combobox', { name: 'This contact is the' })
    .selectOption({ label: `Employer ${token} (reciprocal: Employee ${token})` })
  await dialog.getByLabel('From', { exact: true }).fill('2026-01-01')
  await dialog.getByRole('button', { name: 'Save relationship', exact: true }).click()
  await expect(dialog.getByRole('cell', { name: `Related ${token}`, exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Communications', exact: true }).click()
  await dialog.getByRole('button', { name: 'Record communication' }).click()
  await dialog.getByLabel('Subject', { exact: true }).fill('Fictional follow-up')
  await dialog.getByLabel('Occurred on').fill('2026-10-24')
  await dialog.getByLabel('Text', { exact: true }).fill('Fictional conversation notes')
  await dialog.getByRole('button', { name: 'Save communication' }).click()
  await expect(
    dialog.getByRole('button', { name: 'Fictional follow-up', exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '← Contacts', exact: true }).click()
  await (
    await crmNavigation(page)
  )
    .getByRole('link', { name: 'Campaigns, funds and appeals', exact: true })
    .click()
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click()
  const fundraising = page.getByRole('region', { name: 'Fundraising editor' })
  await fundraising.getByLabel('Name', { exact: true }).fill(`Campaign ${token}`)
  await fundraising
    .getByLabel('Description', { exact: true })
    .fill('Fictional campaign description')
  await fundraising.getByLabel('Goal amount (optional)').fill('125.00')
  await fundraising.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: `Campaign ${token}`, exact: true }).click()
  await expect(fundraising.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'Fictional campaign description',
  )
  await fundraising.getByRole('button', { name: 'Close', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})

test('pledge payments and membership terms persist in the Worker', async ({ page }) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
        timeout: 120000,
      })
    ).ok(),
  ).toBe(true)
  const token = Date.now().toString(),
    name = `Fictional giving ${token}`
  const created = await page.request.post('/api/crm/contacts', {
    data: {
      action: 'create',
      site: 'default',
      profile: { kind: 'person', firstName: name },
      roles: ['donor'],
      operationKey: crypto.randomUUID(),
    },
  })
  expect(created.ok()).toBe(true)
  const contact = (await created.json()).doc.id
  const fundResponse = await page.request.post('/api/crm/finance', {
    data: {
      action: 'create-fund',
      site: 'default',
      name: `Giving fund ${token}`,
      operationKey: crypto.randomUUID(),
    },
  })
  expect(fundResponse.ok()).toBe(true)
  const fund = (await fundResponse.json()).doc.id
  const gift = await page.request.post('/api/crm/finance', {
    data: {
      action: 'create-gift',
      site: 'default',
      constituent: contact,
      amount: { minorUnits: '1000', currency: 'USD' },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-01-31',
      allocations: [{ fund, minorUnits: '1000', currency: 'USD' }],
      reference: '',
      notes: '',
      operationKey: crypto.randomUUID(),
    },
  })
  expect(gift.ok()).toBe(true)
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await (await crmNavigation(page)).getByRole('link', { name: 'Pledges and recurring' }).click()
  await page.getByRole('button', { name: 'Create pledge', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill(`Pledge ${token}`)
  await page.getByRole('searchbox', { name: 'Search donor', exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Donor', exact: true }).selectOption({ label: name })
  await page.getByLabel('Total pledged', { exact: true }).fill('10.00')
  await page.getByLabel('Starts on', { exact: true }).fill('2026-01-31')
  await page.getByLabel('Installment count').fill('2')
  await page.getByRole('button', { name: 'Generate installments' }).click()
  await expect(page.getByLabel('Installment 2 date')).toHaveValue('2026-02-28')
  await page.getByRole('button', { name: 'Save giving record' }).click()
  const detail = page.getByRole('region', { name: 'Giving record details' })
  await expect(
    detail.getByRole('link', {
      name: 'Private record attachments (opens in another tab)',
      exact: true,
    }),
  ).toBeVisible()
  const value = (label: string) =>
    detail
      .locator('dt')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator('+ dd')
  await expect(value('Outstanding')).toHaveText('USD 10.00')
  await detail.getByRole('button', { name: 'Load donor gifts' }).click()
  await expect(
    detail.getByRole('combobox', { name: 'Gift', exact: true }).locator('option'),
  ).toHaveCount(2)
  await detail.getByRole('combobox', { name: 'Gift', exact: true }).selectOption({ index: 1 })
  await detail
    .getByRole('combobox', { name: 'Apply to period', exact: true })
    .selectOption({ label: '2026-01-31' })
  await detail.getByLabel('Payment amount').fill('5.00')
  await detail.getByLabel('Reason', { exact: true }).fill('Fictional installment payment')
  await detail.getByRole('button', { name: 'Apply recorded payment' }).click()
  await expect(value('Outstanding')).toHaveText('USD 5.00')
  await page.reload()
  await (await crmNavigation(page)).getByRole('link', { name: 'Pledges and recurring' }).click()
  await page.getByRole('button', { name: `Pledge ${token}`, exact: true }).click()
  await expect(value('Recorded payment credit')).toHaveText('USD 5.00')
  await detail.getByRole('button', { name: 'Load source gift', exact: true }).click()
  await expect(detail.getByText(/USD 10.00 current net/)).toBeVisible()
  await expect(value('Recorded payment credit')).toHaveText('USD 5.00')
  await detail.getByLabel('Reason', { exact: true }).fill('Fictional application correction')
  await detail.getByRole('button', { name: 'Reverse application', exact: true }).click()
  await expect(value('Recorded payment credit')).toHaveText('USD 0.00')
  await expect(value('Outstanding')).toHaveText('USD 10.00')
  await expect(
    detail.getByText('Fictional installment payment (reversed)', { exact: true }),
  ).toBeVisible()
  await expect(
    detail
      .getByRole('region', { name: 'Giving change history' })
      .getByText('Fictional application correction', { exact: true }),
  ).toBeVisible()
  await (await crmNavigation(page)).getByRole('link', { name: 'Memberships', exact: true }).click()
  await page.getByText('Membership types', { exact: true }).click()
  await page.getByRole('button', { name: 'Create membership type' }).click()
  await page.getByLabel('Type name').fill(`Annual ${token}`)
  await page.getByLabel('Dues amount').fill('10.00')
  await page.getByRole('button', { name: 'Save membership type' }).click()
  await expect(page.getByRole('button', { name: 'Close type editor' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Enroll membership', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Membership type', exact: true })
    .selectOption({ label: `Annual ${token}` })
  await page.getByRole('searchbox', { name: 'Search member', exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Member', exact: true }).selectOption({ label: name })
  await page.getByLabel('Term starts on').fill('2026-01-01')
  await page.getByRole('button', { name: 'Use type term length' }).click()
  await page.getByRole('button', { name: 'Save membership term' }).click()
  await expect(page.getByRole('region', { name: 'Membership term details' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Membership term details' }).getByRole('link', {
      name: 'Private record attachments (opens in another tab)',
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Manage recorded dues payments' }).click()
  await page.getByRole('button', { name: 'Open membership dues' }).click()
  await expect(value('Recorded payment credit')).toHaveText('USD 0.00')
  await page.getByRole('button', { name: 'Renew membership' }).click()
  await expect(page.getByLabel('Term starts on')).toHaveValue('2027-01-01')
  await page.getByRole('button', { name: 'Save membership term' }).click()
  await expect(page.getByRole('button', { name: 'Open previous term' })).toBeVisible()
  const renewalTemplate = await page.request.post('/api/crm/correspondence', {
    data: {
      action: 'save-template',
      site: 'default',
      operationKey: crypto.randomUUID(),
      values: {
        name: `Renewal ${token}`,
        kind: 'membership-renewal',
        subject: 'Renewal for {{recipient.name}}',
        body: '{{membership.type}} ends {{membership.endsOn}}',
      },
    },
  })
  expect(renewalTemplate.ok(), await renewalTemplate.text()).toBe(true)
  const renewalID = (await renewalTemplate.json()).doc.id
  await page.getByRole('link', { name: 'Prepare membership renewal letter', exact: true }).click()
  await expect(page).toHaveURL(/renewalMembership=/)
  const termID = new URL(page.url()).searchParams.get('renewalMembership')!
  await page.reload()
  await page
    .getByRole('combobox', { name: 'Document template', exact: true })
    .selectOption(renewalID)
  await expect(
    page.getByRole('combobox', { name: 'Recorded membership term', exact: true }),
  ).toHaveValue(termID)
  await page.getByLabel('Issuer name', { exact: true }).fill('Fictional nonprofit')
  await page.getByRole('button', { name: 'Preview resolved document', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Resolved document preview' })).toContainText(
    `Annual ${token} ends 2027-12-31`,
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})

test('recurring expectations pause and resume without recording revenue', async ({ page }) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
        timeout: 120000,
      })
    ).ok(),
  ).toBe(true)
  const token = Date.now().toString(),
    name = `Fictional recurring ${token}`
  const response = await page.request.post('/api/crm/contacts', {
    data: {
      action: 'create',
      site: 'default',
      profile: { kind: 'person', firstName: name },
      roles: ['donor'],
      operationKey: crypto.randomUUID(),
    },
  })
  expect(response.ok()).toBe(true)
  const contact = (await response.json()).doc.id
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await (await crmNavigation(page)).getByRole('link', { name: 'Pledges and recurring' }).click()
  await page.getByRole('button', { name: 'Recurring schedules', exact: true }).click()
  await page.getByRole('button', { name: 'Create recurring schedule', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill(`Monthly ${token}`)
  await page.getByRole('searchbox', { name: 'Search donor', exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Donor', exact: true }).selectOption({ label: name })
  await page.getByLabel('Amount per period').fill('10.00')
  await page.getByLabel('Starts on', { exact: true }).fill('2026-01-31')
  await page.getByLabel('Ends on (optional)').fill('2026-04-30')
  await page.getByRole('button', { name: 'Save giving record' }).click()
  const detail = page.getByRole('region', { name: 'Giving record details' })
  await expect(
    detail.getByRole('link', {
      name: 'Private record attachments (opens in another tab)',
      exact: true,
    }),
  ).toBeVisible()
  const expected = detail
    .locator('dt')
    .filter({ hasText: /^Expected$/ })
    .locator('+ dd')
  await expect(expected).toHaveText('USD 40.00')
  await detail.getByLabel('Effective date').fill('2026-02-01')
  await detail.getByLabel('Reason', { exact: true }).fill('Fictional pause')
  await detail.getByRole('button', { name: 'Pause schedule' }).click()
  await expect(expected).toHaveText('USD 10.00')
  await detail.getByLabel('Effective date').fill('2026-03-31')
  await detail.getByLabel('Reason', { exact: true }).fill('Fictional resume')
  await detail.getByRole('button', { name: 'Resume schedule' }).click()
  await expect(expected).toHaveText('USD 30.00')
  const gifts = await page.request.get(
    `/api/crm/finance?site=default&constituent=${encodeURIComponent(contact)}`,
  )
  expect(gifts.ok()).toBe(true)
  expect((await gifts.json()).docs).toHaveLength(0)
})
