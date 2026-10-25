import { expect, test } from '@playwright/test'
import type { CRMRecordType } from '../../src/crm/record-model'

test('typed record files persist in their pinned tab while the original household draft stays intact', async ({
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
  const token = Date.now().toString()
  const post = async (path: string, data: Record<string, unknown>) => {
    const response = await page.request.post(`/api/crm/${path}`, {
      data: { site: 'default', operationKey: crypto.randomUUID(), ...data },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc as { id: string }
  }
  const contact = (
    await post('contacts', {
      action: 'create',
      profile: { kind: 'person', firstName: `Fictional file donor ${token}` },
      roles: ['donor'],
    })
  ).id
  const houseName = `Fictional file household ${token}`
  const house = (
    await post('households', {
      action: 'create-household',
      values: { name: houseName, address: 'Fictional address' },
    })
  ).id
  const refs: Array<{ type: CRMRecordType; id: string }> = [{ type: 'household', id: house }]
  const fund = (
    await post('finance', { action: 'create-fund', name: `Fictional file fund ${token}` })
  ).id
  const gift = (
    await post('finance', {
      action: 'create-gift',
      constituent: contact,
      amount: { currency: 'USD', minorUnits: '100' },
      exponent: 2,
      kind: 'cash',
      receivedOn: '2026-10-24',
      allocations: [{ fund, currency: 'USD', minorUnits: '100' }],
      reference: `Fictional file gift ${token}`,
      notes: '',
    })
  ).id
  refs.push({ type: 'gift', id: gift })
  for (const kind of ['pledge', 'recurring'] as const) {
    const id = (
      await post('giving', {
        action: 'create',
        values: {
          kind,
          constituent: contact,
          name: `Fictional file ${kind} ${token}`,
          currency: 'USD',
          exponent: 2,
          minorUnits: '100',
          frequency: 'monthly',
          startsOn: '2026-10-24',
          ...(kind === 'pledge'
            ? { installments: [{ dueOn: '2026-10-24', minorUnits: '100' }] }
            : {}),
        },
      })
    ).id
    refs.push({ type: kind, id })
  }
  const type = (
    await post('memberships', {
      action: 'save-type',
      values: {
        name: `Fictional file membership ${token}`,
        eligibility: 'person',
        termMonths: 12,
        minorUnits: '0',
        currency: 'USD',
        exponent: 2,
      },
    })
  ).id
  refs.push({
    type: 'membership',
    id: (
      await post('memberships', {
        action: 'enroll',
        values: { type, typeRevision: 1, person: contact, startsOn: '2026-10-24' },
      })
    ).id,
  })
  const pipeline = (
    await post('opportunities', {
      action: 'save-pipeline',
      values: { name: `Fictional file pipeline ${token}` },
    })
  ).id
  const stages = await page.request.get(
    `/api/crm/opportunities?site=default&view=stages&pipeline=${pipeline}`,
  )
  expect(stages.ok()).toBe(true)
  const stage = (await stages.json()).docs[0].id
  refs.push({
    type: 'opportunity',
    id: (
      await post('opportunities', {
        action: 'save',
        values: {
          name: `Fictional file opportunity ${token}`,
          constituent: contact,
          pipeline,
          stage,
          currency: 'USD',
          exponent: 2,
        },
      })
    ).id,
  })
  refs.push({
    type: 'volunteer-activity',
    id: (
      await post('volunteers', {
        action: 'save-activity',
        values: {
          name: `Fictional file activity ${token}`,
          startsOn: '2026-10-24',
          endsOn: '2026-10-24',
          state: 'planned',
          skills: [],
        },
      })
    ).id,
  })

  await page.goto('/admin/crm?site=default', { waitUntil: 'domcontentloaded' })
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('button', { name: 'Households', exact: true })
    .click()
  await page.getByRole('searchbox', { name: 'Search households' }).fill(houseName)
  await page.getByRole('button', { name: houseName, exact: true }).click()
  const household = page.getByRole('region', { name: 'Household editor' })
  const draft = `${houseName} unsaved draft`
  await household.getByLabel('Name', { exact: true }).fill(draft)
  const [filesTab] = await Promise.all([
    page.context().waitForEvent('page'),
    household
      .getByRole('link', { name: 'Private record attachments (opens in another tab)', exact: true })
      .click(),
  ])
  for (const [index, ref] of refs.entries()) {
    if (index)
      await filesTab.goto(
        `/admin/crm?${new URLSearchParams({ site: 'default', view: 'attachments', recordType: ref.type, recordID: ref.id })}`,
        { waitUntil: 'domcontentloaded' },
      )
    const files = filesTab.getByRole('region', { name: 'Private CRM attachments' })
    await expect(files.getByText(/Related record: Fictional/)).toBeVisible()
    await files.getByLabel('Attachment information category').selectOption('communications')
    const name = `Fictional-${ref.type}.txt`,
      contents = Buffer.from(`Fictional ${ref.type} supporting file`)
    await files
      .getByLabel('Attachment file')
      .setInputFiles({ name, mimeType: 'text/plain', buffer: contents })
    await files.getByRole('button', { name: 'Upload private attachment', exact: true }).click()
    const download = files.getByRole('link', { name: `Download ${name}`, exact: true })
    await expect(download).toBeVisible()
    const response = await filesTab.request.get((await download.getAttribute('href'))!)
    expect(response.ok()).toBe(true)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    expect(await response.body()).toEqual(contents)
    await filesTab.reload({ waitUntil: 'domcontentloaded' })
    await expect(download).toBeVisible()
    await expect(household.getByLabel('Name', { exact: true })).toHaveValue(draft)
  }
  await filesTab.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => filesTab.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await filesTab.close()
  page.once('dialog', (dialog) => dialog.accept())
  await household.getByRole('button', { name: 'Close household', exact: true }).click()
  await expect(household).toHaveCount(0)
  await page
    .getByRole('navigation', { name: 'CRM sections' })
    .getByRole('button', { name: 'Contacts', exact: true })
    .click()
  await page.getByRole('searchbox').fill(`Fictional file donor ${token}`)
  await page.getByRole('button', { name: `Fictional file donor ${token}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'Gifts', exact: true }).click()
  await dialog.getByRole('button', { name: '2026-10-24', exact: true }).click()
  const [giftFiles] = await Promise.all([
    page.context().waitForEvent('page'),
    dialog
      .getByRole('region', { name: 'Gift details' })
      .getByRole('link', { name: 'Private record attachments (opens in another tab)', exact: true })
      .click(),
  ])
  await expect(
    giftFiles.getByRole('link', { name: 'Download Fictional-gift.txt', exact: true }),
  ).toBeVisible()
  await giftFiles.close()
  await dialog.getByRole('button', { name: 'Close contact', exact: true }).click()
})
