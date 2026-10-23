import { expect, test } from '@playwright/test'

test.use({ actionTimeout: 20000 })
test('local site administration preserves old CRM editors when another tab switches sites', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(600000)
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
    timeout: 120000,
  })
  expect(login.ok()).toBe(true)
  const origin = new URL(baseURL!).origin
  const initial = await page.request.get('/api/organization-admin')
  expect(initial.ok()).toBe(true)
  const original = (await initial.json()).context as { site: string; revision: number }
  const rootSettings = await page.request.get('/api/globals/site-settings', {
    headers: { 'x-vorticause-site': 'default' },
  })
  expect(rootSettings.ok()).toBe(true)
  const rootIdentity = await rootSettings.json()
  const rootSave = await page.request.post('/api/globals/site-settings', {
    headers: { 'x-vorticause-site': 'default' },
    data: {
      siteName: rootIdentity.siteName || 'Fictional local review',
      siteTagline: rootIdentity.siteTagline || '',
    },
  })
  expect(rootSave.ok(), await rootSave.text()).toBe(true)
  const savedRoot = (await rootSave.json()).result
  expect(savedRoot).toBeTruthy()
  expect(savedRoot).not.toHaveProperty('platformGlobalProof')
  // Start the existing editor with an explicit site, regardless of the stored preference.
  await page.goto('/admin/crm?site=default')
  await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible()
  const oldEditor = page
  const admin = await context.newPage(),
    stamp = Date.now().toString(36)
  try {
    await admin.goto('/admin/sites')
    await expect(
      admin.getByRole('heading', { name: 'Sites and permissions', exact: true }),
    ).toBeVisible()
    await expect(admin.getByRole('combobox', { name: 'Action', exact: true })).toBeVisible()
    await admin
      .getByRole('combobox', { name: 'Action', exact: true })
      .selectOption('create-organization')
    await admin.getByLabel('Name', { exact: true }).fill('Fictional browser network ' + stamp)
    await admin.getByLabel('Root site name', { exact: true }).fill('Fictional National ' + stamp)
    await admin.getByRole('button', { name: 'Save reviewed change', exact: true }).click()
    await expect(
      admin.getByText('Saved. The change has been audited.', { exact: true }),
    ).toBeVisible()
    await admin
      .getByRole('combobox', { name: 'Site to administer', exact: true })
      .selectOption({ label: 'Fictional National ' + stamp })
    await expect(
      admin.getByRole('heading', { name: 'Fictional National ' + stamp, exact: true }),
    ).toBeVisible()
    await admin.getByRole('combobox', { name: 'Action', exact: true }).selectOption('create-site')
    await admin.getByLabel('Name', { exact: true }).fill('Fictional Local ' + stamp)
    await admin.getByRole('button', { name: 'Save reviewed change', exact: true }).click()
    await expect(
      admin.getByText('Saved. The change has been audited.', { exact: true }),
    ).toBeVisible()
    await admin
      .getByRole('combobox', { name: 'Site to administer', exact: true })
      .selectOption({ label: 'Fictional Local ' + stamp })
    const local = await admin
      .getByRole('combobox', { name: 'Site to administer', exact: true })
      .inputValue()
    await expect(
      admin.getByRole('heading', { name: 'Fictional Local ' + stamp, exact: true }),
    ).toBeVisible()
    await admin.getByRole('combobox', { name: 'Action', exact: true }).selectOption('site-settings')
    await admin.getByLabel('Site name', { exact: true }).fill('Fictional identity ' + stamp)
    await admin.getByLabel('Timezone', { exact: true }).fill('America/Chicago')
    await admin.route('**/api/organization-admin', async (route) => {
      if (route.request().method() === 'POST')
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'This record changed. Reload and review before saving.',
          }),
        })
      else await route.continue()
    })
    await admin.getByRole('button', { name: 'Save reviewed change', exact: true }).click()
    await expect(admin.locator('p[role="alert"]')).toContainText(
      'This record changed. Reload and review before saving.',
    )
    await expect(admin.getByLabel('Site name', { exact: true })).toHaveValue(
      'Fictional identity ' + stamp,
    )
    await admin.unroute('**/api/organization-admin')
    await admin.getByRole('button', { name: 'Save reviewed change', exact: true }).click()
    await expect(
      admin.getByText('Saved. The change has been audited.', { exact: true }),
    ).toBeVisible()
    expect(
      (
        await (
          await page.request.get('/api/organization-admin?site=' + local + '&settings=1')
        ).json()
      ).settings.siteName,
    ).toBe('Fictional identity ' + stamp)
    await admin
      .getByRole('button', { name: 'Use selected site for new editors', exact: true })
      .click()
    await expect(
      admin.getByText(
        'Site preference saved for new editors. Existing editors keep their original site.',
        { exact: true },
      ),
    ).toBeVisible()
    await oldEditor.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(oldEditor.getByRole('combobox', { name: 'CRM site', exact: true })).toHaveValue(
      'default',
    )
    const fresh = await context.newPage()
    await fresh.goto('/admin/crm')
    await expect(fresh.getByRole('combobox', { name: 'CRM site', exact: true })).toHaveValue(local)
    await oldEditor.getByRole('button', { name: 'New contact', exact: true }).click()
    const dialog = oldEditor.getByRole('dialog')
    await dialog.getByLabel('First name', { exact: true }).fill('Fictional pinned ' + stamp)
    await dialog.getByLabel('Last name', { exact: true }).fill('Contact')
    await dialog.getByRole('button', { name: 'Save contact', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const read = async (site: string) =>
      (
        await (
          await page.request.get(
            '/api/crm/contacts?' +
              new URLSearchParams({ site, search: 'Fictional pinned ' + stamp }),
          )
        ).json()
      ).docs
    expect(await read('default')).toHaveLength(1)
    expect(await read(local)).toHaveLength(0)
    await admin.setViewportSize({ width: 390, height: 844 })
    expect(
      await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await fresh.close()
  } finally {
    const latest = await (await page.request.get('/api/organization-admin')).json()
    await page.request.post('/api/organization-admin', {
      headers: { Origin: origin },
      data: {
        action: 'context',
        site: original.site,
        expectedRevision: latest.context.revision,
        operationKey: crypto.randomUUID(),
      },
    })
    await admin.close()
  }
})
