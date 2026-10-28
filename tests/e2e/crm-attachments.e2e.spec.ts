import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('private contact attachments upload, resume, persist, download and archive in the native Worker', async ({
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
  const name = `Fictional attachment ${Date.now()}`
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
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await page.getByRole('searchbox').fill(name)
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.locator('.vc-crm-detail')
  await dialog.getByRole('tab', { name: 'Information', exact: true }).click()
  await dialog.getByRole('button', { name: 'Private attachments', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Save contact', exact: true })).toHaveCount(0)
  const files = dialog.getByRole('region', { name: 'Private CRM attachments' })
  await files
    .getByRole('combobox', { name: 'Attachment information category' })
    .selectOption('finances')
  const contents = Buffer.from('Fictional private receipt supporting document.')
  await files
    .getByLabel('Attachment file')
    .setInputFiles({ name: 'Fictional.txt', mimeType: 'text/plain', buffer: contents })
  await files.getByRole('button', { name: 'Upload private attachment', exact: true }).click()
  const download = files.getByRole('link', { name: 'Download Fictional.txt', exact: true })
  await expect(download).toBeVisible()
  const response = await page.request.get((await download.getAttribute('href'))!)
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toBe('application/octet-stream')
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(await response.body()).toEqual(contents)
  await dialog.getByRole('button', { name: '← Contacts', exact: true }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('searchbox').fill(name)
  await page.getByRole('button', { name, exact: true }).click()
  await dialog.getByRole('tab', { name: 'Information', exact: true }).click()
  await dialog.getByRole('button', { name: 'Private attachments', exact: true }).click()
  await expect(download).toBeVisible()
  const resumed = Buffer.from('Fictional interrupted upload to resume.')
  const stage = await page.request.post('/api/crm/attachments', {
    data: {
      site: 'default',
      recordType: 'contact',
      recordID: contact,
      action: 'stage',
      operationKey: crypto.randomUUID(),
      values: {
        filename: 'Resumed.txt',
        size: resumed.length,
        sha256: createHash('sha256').update(resumed).digest('hex'),
        category: 'communications',
      },
    },
  })
  expect(stage.ok(), await stage.text()).toBe(true)
  await files.getByRole('button', { name: 'Refresh attachments', exact: true }).click()
  await files.getByRole('button', { name: 'Resume upload Resumed.txt', exact: true }).click()
  await files
    .getByLabel('Attachment file')
    .setInputFiles({ name: 'Resumed.txt', mimeType: 'text/plain', buffer: resumed })
  await files.getByRole('button', { name: 'Resume selected upload', exact: true }).click()
  await expect(files.getByRole('link', { name: 'Download Resumed.txt', exact: true })).toBeVisible()
  await files.getByRole('button', { name: 'Archive Fictional.txt', exact: true }).click()
  await expect(download).toHaveCount(0)
  await files.getByRole('checkbox', { name: 'Archived attachments', exact: true }).check()
  await expect(download).toBeVisible()
  await files.getByRole('button', { name: 'Restore Fictional.txt', exact: true }).click()
  await expect(download).toHaveCount(0)
  await files.getByRole('checkbox', { name: 'Archived attachments', exact: true }).uncheck()
  await expect(download).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await dialog.getByRole('button', { name: '← Contacts', exact: true }).click()
})
