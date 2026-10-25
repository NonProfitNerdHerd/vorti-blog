import { expect, test } from '@playwright/test'
import { utils, write } from 'xlsx'

test('staff import CSV through preview, mapping, background review, explicit approval and private results', async ({
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
  const suffix = Date.now(),
    name = `Fictional browser import ${suffix}`,
    first = `Fictional imported Ada ${suffix}`,
    second = `Fictional imported Bea ${suffix}`
  await page.goto('/admin/crm?site=default&view=imports')
  await page.getByRole('button', { name: 'Start an import', exact: true }).click()
  await page.getByLabel('Import name', { exact: true }).fill(name)
  await page
    .getByLabel('Source platform or dataset', { exact: true })
    .fill(`Fictional legacy ${suffix}`)
  await page.getByLabel('CSV or XLSX file', { exact: true }).setInputFiles({
    name: 'fictional-donors.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`ID,Name\r\nA,${first}\r\nB,${second}\r\n`),
  })
  await page.getByRole('button', { name: 'Upload and preview', exact: true }).click()
  await page.getByRole('button', { name: 'Preview source', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Source preview' })).toContainText(first)
  await page.getByRole('button', { name: 'Use these columns', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare source rows for mapping', exact: true }).click()
  await page.getByLabel('Source record identifier source', { exact: true }).selectOption('0')
  await page.getByLabel('First name source', { exact: true }).selectOption('1')
  await page.getByRole('button', { name: 'Translate first name values', exact: true }).click()
  const translations = page.getByRole('region', {
    name: 'First name value translations',
    exact: true,
  })
  await translations
    .getByRole('button', { name: 'Browse distinct source values', exact: true })
    .click()
  await translations.getByRole('listitem').filter({ hasText: first }).getByRole('button').click()
  await page.getByLabel('First name translated value 1', { exact: true }).fill(`${first} mapped`)
  await page
    .getByRole('combobox', { name: 'Unmatched first name values', exact: true })
    .selectOption('source')
  await page.getByRole('button', { name: 'Apply mapping to this import', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Prepare undecided row reviews', exact: true }),
  ).toBeEnabled()
  const id = new URL(page.url()).searchParams.get('importID')!
  expect(id).toBeTruthy()
  await page.reload()
  await expect(page.getByLabel('First name source', { exact: true })).toHaveValue('1')
  const before = await page.request.get(
    `/api/crm/contacts?site=default&search=${encodeURIComponent(first)}`,
  )
  expect((await before.json()).total).toBe(0)
  await page.getByRole('button', { name: 'Prepare undecided row reviews', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Approve and apply reviewed records', exact: true }),
  ).toBeEnabled({ timeout: 120000 })
  expect(
    (
      await (
        await page.request.get(`/api/crm/contacts?site=default&search=${encodeURIComponent(first)}`)
      ).json()
    ).total,
  ).toBe(0)
  await page.getByRole('button', { name: 'Open row 2', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Saved proposed changes' })).toContainText(first)
  await expect(
    page.getByRole('region', { name: 'Field comparison' }).getByRole('table'),
  ).toContainText(`${first} mapped`)
  page.once('dialog', (dialog) => dialog.accept())
  await page
    .getByRole('button', { name: 'Approve and apply reviewed records', exact: true })
    .click()
  await expect(page.getByText(/2 applied · 2 created/)).toBeVisible({ timeout: 120000 })
  await page.reload()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByText(/2 applied · 2 created/)).toBeVisible()
  expect(
    (
      await (
        await page.request.get(`/api/crm/contacts?site=default&search=${encodeURIComponent(first)}`)
      ).json()
    ).total,
  ).toBe(1)
  const mapped = await page.request.get(
    `/api/crm/contacts?site=default&search=${encodeURIComponent(first)}`,
  )
  expect((await mapped.json()).docs[0].label).toBe(`${first} mapped`)
  await page.getByRole('button', { name: 'Prepare full results CSV', exact: true }).click()
  const fullDownload = page.getByRole('link', { name: 'Download full results CSV', exact: true })
  await expect(fullDownload).toBeVisible({ timeout: 120000 })
  await page.reload()
  await expect(fullDownload).toBeVisible()
  const csv = await page.request.get((await fullDownload.getAttribute('href'))!)
  expect(csv.ok(), await csv.text()).toBe(true)
  expect(csv.headers()['cache-control']).toBe('private, no-store')
  expect(await csv.text()).toContain(first)
  expect(await csv.text()).toContain(second)
  expect(csv.headers()['x-import-matching-rows']).toBe('2')
  await page.getByRole('button', { name: 'Prepare error rows CSV', exact: true }).click()
  const errorDownload = page.getByRole('link', { name: 'Download error rows CSV', exact: true })
  await expect(errorDownload).toBeVisible({ timeout: 120000 })
  const errors = await page.request.get((await errorDownload.getAttribute('href'))!)
  expect(errors.ok()).toBe(true)
  expect(errors.headers()['x-import-matching-rows']).toBe('0')
  expect(await errors.text()).not.toContain(first)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const layout = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth + 2,
    viewport: window.innerWidth,
    width: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('.vc-crm *')]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 2)
      .slice(0, 25)
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        parent: element.parentElement?.className,
        right: element.getBoundingClientRect().right,
        minWidth: getComputedStyle(element).minWidth,
        overflowX: getComputedStyle(element).overflowX,
      })),
  }))
  expect(layout.fits, JSON.stringify(layout)).toBe(true)
})

test('staff import XLSX gifts with a named legacy-fund translation and retain distinct exact financial records', async ({
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
  const suffix = Date.now(),
    donorName = `Fictional XLSX donor ${suffix}`,
    fundName = `Fictional XLSX fund ${suffix}`
  const post = async (path: string, data: Record<string, unknown>) => {
    const response = await page.request.post(`/api/crm/${path}`, {
      data: { site: 'default', operationKey: crypto.randomUUID(), ...data },
    })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc as { id: string }
  }
  const donor = await post('contacts', {
    action: 'create',
    profile: { kind: 'person', firstName: donorName },
    roles: ['donor'],
  })
  const fund = await post('finance', { action: 'create-fund', name: fundName })
  const book = utils.book_new()
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['ID', 'Donor', 'Amount', 'Fund', 'Received'],
      ['gift-A', donor.id, '900719925474099.31', 'LEGACY-FUND', '2026-10-25'],
      ['gift-B', donor.id, '900719925474099.31', 'LEGACY-FUND', '2026-10-25'],
    ]),
    'Gifts',
  )
  await page.goto('/admin/crm?site=default&view=imports')
  await page.getByRole('combobox', { name: 'Import section', exact: true }).selectOption('gifts')
  await page.getByRole('button', { name: 'Start an import', exact: true }).click()
  await page.getByLabel('Import name', { exact: true }).fill(`Fictional XLSX giving ${suffix}`)
  await page
    .getByLabel('Source platform or dataset', { exact: true })
    .fill(`Legacy giving ${suffix}`)
  await page.getByLabel('CSV or XLSX file', { exact: true }).setInputFiles({
    name: 'fictional-gifts.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(write(book, { type: 'array', bookType: 'xlsx' })),
  })
  await page.getByRole('button', { name: 'Upload and preview', exact: true }).click()
  await page.getByRole('button', { name: 'Preview source', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Source preview' })).toContainText('LEGACY-FUND')
  await page.getByRole('button', { name: 'Use these columns', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare source rows for mapping', exact: true }).click()
  for (const [name, column] of [
    ['Source record identifier', '0'],
    ['Contact', '1'],
    ['Gift amount', '2'],
    ['Fund', '3'],
    ['Received date', '4'],
  ])
    await page.getByRole('combobox', { name: `${name} source`, exact: true }).selectOption(column)
  for (const [name, value] of [
    ['Currency', 'USD'],
    ['Currency decimal places', '2'],
  ]) {
    await page.getByRole('combobox', { name: `${name} source`, exact: true }).selectOption('fixed')
    await page.getByLabel(`${name} fixed value`, { exact: true }).fill(value)
  }
  await page.getByRole('button', { name: 'Translate fund values', exact: true }).click()
  await page.getByLabel('Fund original value 1', { exact: true }).fill('LEGACY-FUND')
  await page.getByRole('button', { name: 'Choose fund for value 1', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search fund', exact: true }).fill(fundName)
  await page.getByRole('button', { name: `Use ${fundName}`, exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Fund source', exact: true })).toHaveValue('3')
  await page.getByRole('button', { name: 'Apply mapping to this import', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare undecided row reviews', exact: true }).click()
  const approve = page.getByRole('button', {
    name: 'Approve and apply reviewed records',
    exact: true,
  })
  await expect(approve).toBeEnabled({ timeout: 120000 })
  const gifts = async () =>
    (await (
      await page.request.get(`/api/crm/finance?site=default&constituent=${donor.id}`)
    ).json()) as {
      total: number
      docs: Array<{
        originalMinor: string
        allocations: Array<{ fund: string; minorUnits: string }>
      }>
    }
  expect((await gifts()).total).toBe(0)
  page.once('dialog', (dialog) => dialog.accept())
  await approve.click()
  await expect(page.getByText(/2 applied · 2 created/)).toBeVisible({ timeout: 120000 })
  await page.reload()
  const received = await gifts()
  expect(received.total).toBe(2)
  for (const gift of received.docs) {
    expect(gift.originalMinor).toBe('90071992547409931')
    expect(gift.allocations).toEqual([
      { fund: fund.id, currency: 'USD', minorUnits: '90071992547409931' },
    ])
  }
})
