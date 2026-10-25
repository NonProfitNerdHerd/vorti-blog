import { expect, test } from '@playwright/test'

test('save a donor call, assign another staff member and complete the follow-up in existing Tasks', async ({
  page,
  browser,
  baseURL,
}) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
        timeout: 120000,
      })
    ).ok(),
  ).toBe(true)
  const name = `Fictional follow-up donor ${Date.now()}`
  const created = await page.request.post('/api/crm/contacts', {
    data: {
      site: 'default',
      action: 'create',
      profile: { kind: 'person', firstName: name },
      roles: ['donor', 'volunteer'],
      operationKey: crypto.randomUUID(),
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const contact = (await created.json()).doc
  const staff = await page.request.get(
    '/api/users?where[username][equals]=crm-followup-assignee&limit=1&depth=0',
  )
  expect(staff.ok(), await staff.text()).toBe(true)
  const assignee = (await staff.json()).docs[0]
  expect(assignee?.id).toBeTruthy()
  await page.goto(
    `/admin/crm?${new URLSearchParams({ site: 'default', view: 'contacts', contact: contact.id })}`,
  )
  await page.getByRole('tab', { name: 'Communications', exact: true }).click()
  await page.getByRole('button', { name: 'Record communication', exact: true }).click()
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('phone')
  await page.getByLabel('Subject', { exact: true }).fill(`Renewal call ${name}`)
  await page.getByLabel('Occurred on', { exact: true }).fill('2026-10-25')
  await page
    .getByLabel('Text', { exact: true })
    .fill('Fictional donor requested a follow-up from another staff member.')
  await page.getByRole('button', { name: 'Save and assign follow-up', exact: true }).click()
  await page.getByRole('button', { name: 'New follow-up', exact: true }).click()
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue(`Renewal call ${name}`)
  await page.getByLabel('Find assignee', { exact: true }).fill('crm-followup-assignee')
  await expect(
    page
      .getByRole('combobox', { name: 'Assign to', exact: true })
      .locator(`option[value="${assignee.id}"]`),
  ).toHaveCount(1)
  await page
    .getByRole('combobox', { name: 'Assign to', exact: true })
    .selectOption(String(assignee.id))
  await page.getByLabel('Follow-up due date', { exact: true }).fill('2026-11-01')
  await page.getByRole('button', { name: 'Create follow-up task', exact: true }).click()
  const link = page.getByRole('link', { name: `Renewal call ${name}`, exact: true })
  await expect(link).toBeVisible()
  const staffContext = await browser.newContext({ baseURL })
  expect(
    (
      await staffContext.request.post('/api/users/login', {
        data: {
          email: 'crm-followup-assignee@example.invalid',
          password: 'local-followup-only-password',
        },
        timeout: 120000,
      })
    ).ok(),
  ).toBe(true)
  const taskPage = await staffContext.newPage()
  await taskPage.goto((await link.getAttribute('href'))!)
  const dialog = taskPage.locator('.editor-dialog-layer')
  await expect(dialog.getByLabel('Task title', { exact: true })).toHaveValue(`Renewal call ${name}`)
  await dialog.getByLabel('Status', { exact: true }).selectOption('done')
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toBeEnabled()
  await page.bringToFront()
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click()
  await page.getByRole('combobox', { name: 'Task status', exact: true }).selectOption('completed')
  await expect(link).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: 'Communications', exact: true }).click()
  await page.getByRole('button', { name: 'Open follow-up tasks', exact: true }).click()
  await page.getByRole('combobox', { name: 'Task status', exact: true }).selectOption('completed')
  await expect(link).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(link).toBeVisible()
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click()
  const history = page.getByRole('region', { name: 'Authorized contact timeline' })
  const completion = history.getByRole('article', { name: 'Follow-up completed' })
  await expect(completion).toContainText(`Renewal call ${name}`)
  await expect(
    completion.getByRole('link', { name: 'Open follow-up task (opens in another tab)' }),
  ).toHaveAttribute('href', /\/collections\/review-tasks\?site=default&task=/)
  await staffContext.close()
})
