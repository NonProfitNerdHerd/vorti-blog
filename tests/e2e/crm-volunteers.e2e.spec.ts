import { expect, test } from '@playwright/test'
test('volunteer skills, outreach preferences, attendance and approved hours persist independently', async ({
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
    name = `Fictional volunteer ${token}`,
    activityName = `Food drive ${token}`
  const created = await page.request.post('/api/crm/contacts', {
    data: {
      action: 'create',
      site: 'default',
      profile: { kind: 'person', firstName: name },
      roles: ['volunteer'],
      operationKey: crypto.randomUUID(),
    },
  })
  expect(created.ok()).toBe(true)
  const contact = (await created.json()).doc.id
  await page.goto('/admin/crm?site=default', { waitUntil: 'domcontentloaded' })
  const modules = page.getByRole('navigation', { name: 'CRM sections' })
  await modules.getByRole('button', { name: 'Volunteers', exact: true }).click()
  const navigation = page.getByRole('navigation', { name: 'Volunteer sections' })
  await page.getByRole('button', { name: 'Create volunteer profile', exact: true }).click()
  const profile = page.getByRole('region', { name: 'Volunteer profile editor' })
  await profile.getByRole('searchbox', { name: 'Search volunteer person', exact: true }).fill(name)
  await profile
    .getByRole('combobox', { name: 'Volunteer person', exact: true })
    .selectOption({ label: name })
  await profile.getByLabel('Skills (comma separated)').fill('Logistics, First aid')
  await profile.getByLabel('Interests (comma separated)').fill('Food relief')
  await profile.getByLabel('Availability (discoverable)').fill('Saturday afternoons')
  await profile.getByRole('button', { name: 'Save volunteer profile', exact: true }).click()
  await expect(profile).toHaveCount(0)
  await navigation.getByRole('button', { name: 'Chapter activities', exact: true }).click()
  await page.getByRole('button', { name: 'Create volunteer activity', exact: true }).click()
  const activity = page.getByRole('region', { name: 'Volunteer activity editor' })
  await activity.getByLabel('Activity name').fill(activityName)
  await activity.getByLabel('Activity starts on').fill('2026-11-01')
  await activity.getByLabel('Activity ends on').fill('2026-11-01')
  await activity.getByLabel('Needed skills (comma separated)').fill('Logistics')
  await activity.getByRole('button', { name: 'Save volunteer activity', exact: true }).click()
  await activity.getByRole('button', { name: 'Invitations and responses', exact: true }).click()
  await activity.getByRole('button', { name: 'Record outreach invitation', exact: true }).click()
  await activity
    .getByRole('searchbox', { name: 'Discover volunteer skills', exact: true })
    .fill(name)
  await activity
    .getByRole('combobox', { name: 'Outreach volunteer', exact: true })
    .selectOption(contact)
  await activity.getByLabel('Outreach occurred on').fill('2026-10-24')
  await activity.getByLabel('Recorded outreach details').fill('Fictional recorded phone invitation')
  await activity.getByRole('button', { name: 'Save recorded invitation', exact: true }).click()
  await activity.getByRole('button', { name: `Record response for ${name}`, exact: true }).click()
  await activity
    .getByRole('combobox', { name: 'Invitation response', exact: true })
    .selectOption('declined')
  await activity.getByLabel('Response received on').fill('2026-10-25')
  await activity.getByLabel('Response details').fill('Unavailable for initial invitation')
  await activity.getByRole('button', { name: 'Save invitation response', exact: true }).click()
  await expect(activity.getByRole('group', { name: 'Volunteer response editor' })).toHaveCount(0)
  const preference = await page.request.get(
    `/api/crm/volunteers?site=default&view=profile&id=${contact}`,
  )
  expect(preference.ok()).toBe(true)
  expect((await preference.json()).doc.contact_allowed).toBe(1)
  await activity.getByRole('button', { name: 'Participation', exact: true }).click()
  await activity
    .getByRole('button', { name: 'Register volunteer participation', exact: true })
    .click()
  await activity
    .getByRole('searchbox', { name: 'Search participating person', exact: true })
    .fill(name)
  await activity
    .getByRole('combobox', { name: 'Participating person', exact: true })
    .selectOption({ label: name })
  await activity
    .getByRole('combobox', { name: 'Participation status', exact: true })
    .selectOption('attended')
  await activity
    .getByLabel('Chapter participation details')
    .fill('Later confirmed actual attendance')
  await activity.getByRole('button', { name: 'Save participation', exact: true }).click()
  await expect(activity.getByRole('cell', { name: 'attended', exact: true })).toBeVisible()
  await activity.getByRole('button', { name: 'Activity hours', exact: true }).click()
  await activity.getByRole('button', { name: 'Record volunteer hours', exact: true }).click()
  await activity
    .getByRole('combobox', { name: 'Attended volunteer', exact: true })
    .selectOption({ label: name })
  await activity.getByLabel('Hours occurred on').fill('2026-11-01')
  await activity.getByLabel('Whole minutes').fill('90')
  await activity.getByRole('button', { name: 'Submit volunteer hours', exact: true }).click()
  await expect(
    activity.getByText('submitted: 1 h 30 min (1 records)', { exact: true }),
  ).toBeVisible()
  await activity.getByRole('button', { name: `Review ${name} 2026-11-01`, exact: true }).click()
  await activity.getByLabel('Hours review reason').fill('Fictional coordinator confirmation')
  await activity.getByRole('button', { name: 'Save hours review', exact: true }).click()
  await expect(
    activity.getByText('approved: 1 h 30 min (1 records)', { exact: true }),
  ).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await modules.getByRole('button', { name: 'Volunteers', exact: true }).click()
  await navigation.getByRole('button', { name: 'Hours and approvals', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('1 h 30 min')
  await navigation.getByRole('button', { name: 'Skills and discovery', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search volunteers or skills', exact: true }).fill(name)
  await page.getByRole('button', { name, exact: true }).click()
  await expect(
    profile.getByRole('textbox', { name: 'Availability (discoverable)', exact: true }),
  ).toHaveValue('Saturday afternoons')
  await profile
    .getByRole('checkbox', {
      name: 'Do not contact for volunteer opportunities in this chapter',
      exact: true,
    })
    .check()
  await profile.getByRole('button', { name: 'Save volunteer profile', exact: true }).click()
  await expect(profile).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Do not contact')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})
