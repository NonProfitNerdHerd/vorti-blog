import { expect, test } from '@playwright/test'

test('contact history paginates, filters, opens related areas and persists on mobile', async ({
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
  const name = `Fictional timeline ${Date.now()}`
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
  for (let index = 0; index < 51; index++) {
    const response = await page.request.post('/api/crm/activities', {
      data: {
        site: 'default',
        contact,
        operationKey: crypto.randomUUID(),
        values: {
          kind: 'note',
          subject: `${name} note ${index}`,
          body: 'Fictional history only',
          occurredOn: '2026-10-24',
        },
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await page.goto('/admin/crm?view=contacts&site=default', { waitUntil: 'domcontentloaded' })
  await page.getByRole('searchbox').fill(name)
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.locator('.vc-crm-detail')
  await dialog.getByRole('tab', { name: 'Activity', exact: true }).click()
  const timeline = dialog.getByRole('region', { name: 'Authorized contact timeline' })
  await expect(timeline.getByText('53 authorized events. Showing 50 on this page.')).toBeVisible()
  await timeline.getByRole('button', { name: 'Older events', exact: true }).click()
  await expect(timeline.getByText('53 authorized events. Showing 3 on this page.')).toBeVisible()
  await expect(timeline.getByRole('button', { name: 'Older events', exact: true })).toBeDisabled()
  await timeline.getByLabel('Timeline area').selectOption('communications')
  await expect(timeline.getByText('51 authorized events. Showing 50 on this page.')).toBeVisible()
  await timeline.getByRole('button', { name: 'View notes and communications', exact: true }).first().click()
  await expect(dialog.getByRole('button', { name: 'Communications', exact: true })).toHaveAttribute('aria-current', 'page')
  await dialog.getByRole('button', { name: '← Contacts', exact: true }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('searchbox').fill(name)
  await page.getByRole('button', { name, exact: true }).click()
  await dialog.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(timeline.getByText('53 authorized events. Showing 50 on this page.')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await dialog.getByRole('button', { name: '← Contacts', exact: true }).click()
})
