import { expect, test, type Locator, type Page } from '@playwright/test'

async function login(page: Page) {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
        timeout: 120000,
      })
    ).ok(),
  ).toBe(true)
}
async function post(page: Page, area: string, values: Record<string, unknown>) {
  const response = await page.request.post(`/api/crm/${area}`, {
    data: { site: 'default', operationKey: crypto.randomUUID(), ...values },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).doc as { id: string; revision: number }
}
async function openBulk(page: Page) {
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('link', { name: 'Receipts and correspondence', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Correspondence sections' })
    .getByRole('button', { name: 'Bulk correspondence', exact: true })
    .click()
}
async function chooseTemplate(editor: Locator, label: string) {
  const picker = editor.getByLabel('Batch template')
  await expect.poll(() => picker.locator('option').count()).toBeGreaterThan(1)
  while (!(await editor.getByRole('option', { name: label, exact: true }).count())) {
    const next = editor.getByRole('button', { name: 'Next batch templates', exact: true })
    expect(await next.isEnabled()).toBe(true)
    const previous = await picker.locator('option').last().getAttribute('value')
    await next.click()
    await expect
      .poll(() => picker.locator('option').last().getAttribute('value'))
      .not.toBe(previous)
  }
  await picker.selectOption({ label })
}
async function createBatch(page: Page, name: string, templateLabel: string) {
  await page.getByRole('button', { name: 'Create correspondence batch', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Correspondence batch editor' })
  await editor.getByLabel('Batch name').fill(name)
  await chooseTemplate(editor, templateLabel)
  await editor.getByLabel('Batch issue date').fill('2026-10-24')
  await editor.getByLabel('Batch issuer name').fill('Fictional bulk charity')
  await editor.getByLabel('Batch issuer address').fill('Fictional bulk office')
  await editor.getByRole('button', { name: 'Save batch configuration', exact: true }).click()
  await expect(
    page
      .getByRole('region', { name: 'Correspondence batch details' })
      .getByRole('heading', { name, exact: true }),
  ).toBeVisible()
}

test('bulk correspondence reviews persist, issue once, and produce private printable documents and PDFs', async ({
  page,
}) => {
  await login(page)
  const token = Date.now().toString(),
    prefix = `Fictional bulk ${token}`,
    name = `Fictional batch ${token}`
  const contacts: string[] = []
  for (const suffix of ['one', 'two'])
    contacts.push(
      (
        await post(page, 'contacts', {
          action: 'create',
          profile: { kind: 'person', firstName: `${prefix} ${suffix}` },
          roles: ['contact'],
        })
      ).id,
    )
  const templateName = `Fictional bulk template ${token}`
  await post(page, 'correspondence', {
    action: 'save-template',
    values: {
      name: templateName,
      kind: 'general',
      subject: 'Hello {{recipient.name}}',
      body: 'Fictional group letter for {{recipient.name}}. Reference {{document.number}}.',
    },
  })
  await openBulk(page)
  await createBatch(page, name, `${templateName} (general)`)
  const selection = page.getByRole('region', { name: 'Batch recipient selection' })
  await selection.getByRole('searchbox', { name: 'Search batch recipients' }).fill(prefix)
  await expect(selection.getByText('2 matching recipients. Showing 2 on this page.')).toBeVisible()
  await selection.getByRole('button', { name: 'Select this recipient page', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Approve batch and issue documents', exact: true }),
  ).toBeDisabled()
  await selection.getByRole('button', { name: 'Prepare selected reviews', exact: true }).click()
  const details = page.getByRole('region', { name: 'Correspondence batch details' })
  await expect(
    details.getByText(
      '2 prepared recipients; 0 issued. 0 reviews have configuration or access changes.',
    ),
  ).toBeVisible()
  await expect(
    details.getByRole('button', { name: 'Approve batch and issue documents', exact: true }),
  ).toBeEnabled()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('link', { name: 'Receipts and correspondence', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Correspondence sections' })
    .getByRole('button', { name: 'Bulk correspondence', exact: true })
    .click()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(
    details.getByText(
      '2 prepared recipients; 0 issued. 0 reviews have configuration or access changes.',
    ),
  ).toBeVisible()
  for (const contact of contacts)
    expect(
      (
        await (
          await page.request.get(
            `/api/crm/correspondence?site=default&view=documents&contact=${contact}`,
          )
        ).json()
      ).docs,
    ).toHaveLength(0)
  await details
    .getByRole('button', { name: `Preview correspondence for ${prefix} one`, exact: true })
    .click()
  await expect(page.getByRole('region', { name: 'Batch recipient preview' })).toContainText(
    `Fictional group letter for ${prefix} one`,
  )
  await page.getByRole('button', { name: 'Close batch recipient preview', exact: true }).click()
  const [approval] = await Promise.all([
    page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/api/crm/correspondence-batches' &&
        request.method() === 'POST' &&
        request.postDataJSON().action === 'approve',
    ),
    details.getByRole('button', { name: 'Approve batch and issue documents', exact: true }).click(),
  ])
  await expect(
    details.getByText(
      '2 prepared recipients; 2 issued. 0 reviews have configuration or access changes.',
    ),
  ).toBeVisible({ timeout: 120000 })
  const download = details.getByRole('link', {
    name: `Download PDF for ${prefix} one`,
    exact: true,
  })
  await expect(download).toBeVisible({ timeout: 120000 })
  await expect(
    details.getByRole('button', { name: 'Close correspondence batch', exact: true }),
  ).toBeEnabled({ timeout: 120000 })
  const pdf = await page.request.get((await download.getAttribute('href'))!)
  expect(pdf.ok()).toBe(true)
  expect(pdf.headers()['cache-control']).toBe('private, no-store')
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
  const print = await page.request.get(
    (await details
      .getByRole('link', { name: `Print document for ${prefix} one`, exact: true })
      .getAttribute('href'))!,
  )
  expect(print.ok()).toBe(true)
  expect(await print.text()).toContain(prefix + ' one')
  const replay = await page.request.post('/api/crm/correspondence-batches', {
    data: approval.postDataJSON(),
  })
  expect(replay.ok(), await replay.text()).toBe(true)
  for (const contact of contacts)
    expect(
      (
        await (
          await page.request.get(
            `/api/crm/correspondence?site=default&view=documents&contact=${contact}`,
          )
        ).json()
      ).docs,
    ).toHaveLength(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await details.getByRole('button', { name: 'Close correspondence batch', exact: true }).click()
})

test('a refunded gift rejects stale bulk receipt approval and can be reviewed and issued with its retained adjustment', async ({
  page,
}) => {
  await login(page)
  const token = Date.now().toString(),
    donor = `Fictional bulk refund ${token}`,
    name = `Fictional refund batch ${token}`
  const contact = (
    await post(page, 'contacts', {
      action: 'create',
      profile: { kind: 'person', firstName: donor },
      roles: ['donor'],
    })
  ).id
  const fund = (
    await post(page, 'finance', { action: 'create-fund', name: `Fictional refund fund ${token}` })
  ).id
  const gift = (
    await post(page, 'finance', {
      action: 'create-gift',
      constituent: contact,
      amount: { currency: 'USD', minorUnits: '1000' },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-10-24',
      allocations: [{ fund, currency: 'USD', minorUnits: '1000' }],
      reference: `Fictional recorded gift ${token}`,
      notes: '',
    })
  ).id
  const templateName = `Fictional bulk receipt ${token}`
  await post(page, 'correspondence', {
    action: 'save-template',
    values: {
      name: templateName,
      kind: 'gift-receipt',
      subject: 'Receipt for {{recipient.name}}',
      body: '{{giving.summary}}',
    },
  })
  await openBulk(page)
  await createBatch(page, name, `${templateName} (gift receipt)`)
  const selection = page.getByRole('region', { name: 'Batch recipient selection' }),
    details = page.getByRole('region', { name: 'Correspondence batch details' })
  await selection.getByRole('searchbox', { name: 'Search batch recipients' }).fill(donor)
  await expect(selection.getByText('1 matching recipients. Showing 1 on this page.')).toBeVisible()
  await selection.getByRole('button', { name: 'Select this recipient page', exact: true }).click()
  await selection.getByRole('button', { name: 'Prepare selected reviews', exact: true }).click()
  await expect(
    details.getByText(
      '1 prepared recipients; 0 issued. 0 reviews have configuration or access changes.',
    ),
  ).toBeVisible()
  await expect(
    details.getByRole('button', { name: 'Approve batch and issue documents', exact: true }),
  ).toBeEnabled()
  await post(page, 'finance', {
    action: 'adjust-gift',
    id: gift,
    adjustment: 'refund',
    deltaMinor: '-200',
    reason: 'Fictional refund after review',
    expectedRevision: 1,
  })
  await details
    .getByRole('button', { name: 'Approve batch and issue documents', exact: true })
    .click()
  await expect(details.getByRole('alert')).toContainText('Refresh pending reviews', {
    timeout: 120000,
  })
  expect(
    (
      await (
        await page.request.get(
          `/api/crm/correspondence?site=default&view=documents&contact=${contact}`,
        )
      ).json()
    ).docs,
  ).toHaveLength(0)
  await details
    .getByRole('button', { name: 'Reopen remaining recipient reviews', exact: true })
    .click()
  await details.getByRole('button', { name: 'Refresh all pending reviews', exact: true }).click()
  await expect(details.getByText(/Reviewed gift on.*USD 8\.00/)).toBeVisible()
  await expect(
    details.getByRole('button', { name: 'Approve batch and issue documents', exact: true }),
  ).toBeEnabled()
  await details
    .getByRole('button', { name: `Preview correspondence for ${donor}`, exact: true })
    .click()
  await expect(page.getByRole('region', { name: 'Batch recipient preview' })).toContainText(
    'USD 8.00',
  )
  await page.getByRole('button', { name: 'Close batch recipient preview', exact: true }).click()
  await details
    .getByRole('button', { name: 'Approve batch and issue documents', exact: true })
    .click()
  await expect(
    details.getByRole('link', { name: `Download PDF for ${donor}`, exact: true }),
  ).toBeVisible({ timeout: 120000 })
  const documents = (
    await (
      await page.request.get(
        `/api/crm/correspondence?site=default&view=documents&contact=${contact}`,
      )
    ).json()
  ).docs
  expect(documents).toHaveLength(1)
  const document = await page.request.get(
    `/api/crm/correspondence?site=default&document=${documents[0].id}`,
  )
  expect((await document.json()).doc.body).toContain('USD 8.00')
  const giving = (
    await (await page.request.get(`/api/crm/finance?site=default&constituent=${contact}`)).json()
  ).docs
  expect(giving).toHaveLength(1)
  expect(giving[0].originalMinor).toBe('1000')
  expect(giving[0].netMinor).toBe('800')
  await expect(
    details.getByRole('button', { name: 'Close correspondence batch', exact: true }),
  ).toBeEnabled({ timeout: 120000 })
  await details.getByRole('button', { name: 'Close correspondence batch', exact: true }).click()
})
