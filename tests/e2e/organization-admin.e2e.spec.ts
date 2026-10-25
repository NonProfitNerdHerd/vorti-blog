import { expect, test } from '@playwright/test'

test('integrated SubSites keeps the sidebar, isolates child websites, and preserves pending editors', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(600000)
  const origin = new URL(baseURL!).origin
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
    timeout: 120000,
  })
  expect(login.ok(), await login.text()).toBe(true)
  const initial = await (await page.request.get('/api/organization-admin')).json()
  const original = initial.context
  const stamp = Date.now().toString(36),
    key = 'browser-child-' + stamp,
    name = 'Fictional child ' + stamp
  async function website(site: string) {
    const response = await page.request.get(`/api/organization-admin?site=${site}&website=1`)
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  async function toggle(site: string, enabled: boolean) {
    const current = await website(site)
    const response = await page.request.post('/api/organization-admin', {
      headers: { Origin: origin },
      data: {
        action: 'subsites',
        site,
        enabled,
        expectedRevision: current.revision,
        confirmedDescendants: current.descendants,
        operationKey: crypto.randomUUID(),
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  const primaryBefore = await website('default')
  if (!primaryBefore.subsites_enabled) await toggle('default', true)
  const old = context.pages()[0]
  await old.goto('/admin/crm?site=default&view=contacts')
  await expect(old.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible()
  await expect(old.locator('.nav__wrap')).toBeVisible()
  await old.getByRole('button', { name: 'New contact', exact: true }).click()
  await old.getByLabel('First name', { exact: true }).fill('Unsaved original site ' + stamp)
  const admin = await context.newPage()
  let previousLogo: unknown = undefined
  let parentMedia: { id: number; filename: string } | undefined
  admin.on('pageerror', (error) => console.log('SubSites browser error:', error.message))
  try {
    const parentSettings = await (
      await page.request.get('/api/globals/site-settings?depth=0')
    ).json()
    previousLogo = parentSettings.logo ?? null
    const upload = await page.request.post('/api/media', {
      headers: { Origin: origin, 'x-vorticause-site': 'default' },
      multipart: {
        _payload: JSON.stringify({
          alt: 'Fictional inherited branding ' + stamp,
          editorSite: 'default',
        }),
        file: {
          name: 'fictional-brand-' + stamp + '.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="blue"/></svg>',
          ),
        },
      },
    })
    expect(upload.ok(), await upload.text()).toBe(true)
    parentMedia = (await upload.json()).doc
    const branding = await page.request.post('/api/globals/site-settings', {
      headers: { Origin: origin, 'x-vorticause-site': 'default' },
      data: { logo: parentMedia!.id },
    })
    expect(branding.ok(), await branding.text()).toBe(true)
    console.log('Opening integrated SubSites')
    await admin.goto('/admin/sites?site=default')
    await expect(admin).toHaveURL(/\/admin\/globals\/site-settings/)
    await expect(admin.getByRole('heading', { name: 'SubSites', exact: true })).toBeVisible()
    await expect(admin.locator('.nav__wrap')).toBeVisible()
    const workspace = admin.locator('.vc-sites')
    console.log('Integrated SubSites loaded')
    await workspace
      .getByRole('combobox', { name: 'Action', exact: true })
      .selectOption('create-site', { timeout: 15000 })
    console.log('Child action selected')
    await workspace.getByLabel('Name', { exact: true }).fill(name)
    console.log('Child name entered')
    await workspace.getByLabel('Website URL key', { exact: true }).fill(key)
    console.log('Child key entered')
    await workspace.getByRole('button', { name: 'Save reviewed change', exact: true }).click()
    console.log('Child creation submitted')
    await expect(workspace.getByText('Saved. The change has been audited.')).toBeVisible()
    const available = await (await page.request.get('/api/organization-admin')).json()
    const child = available.sites.find((site: { name: string }) => site.name === name).id as string
    // Site selection is now shared in the header and always opens that site's dashboard.
    await admin.reload()
    await admin.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(child)
    await expect(admin).toHaveURL(new RegExp('/admin\\?site=' + child))
    await admin.goto('/admin/globals/site-settings?tab=SubSites&site=' + child)
    await expect(workspace.getByRole('heading', { name, exact: true })).toBeVisible()
    const initialized = await website(child)
    expect(initialized.initialized).toBe(1)
    const copiedLogo = JSON.parse(initialized.presentation).logo as number
    expect(copiedLogo).not.toBe(parentMedia!.id)
    const mediaResponse = await page.request.get('/api/media/' + copiedLogo, {
      headers: { 'x-vorticause-site': child },
    })
    expect(mediaResponse.ok(), await mediaResponse.text()).toBe(true)
    const childMedia = await mediaResponse.json()
    expect(childMedia.platformSite).toBe(child)
    expect(childMedia.websiteCopyKey).toBeUndefined()
    expect(
      (
        await page.request.get('/api/media?where[websiteCopyKey][exists]=true', {
          headers: { 'x-vorticause-site': child },
        })
      ).status(),
    ).toBe(400)
    await expect(
      workspace.getByRole('button', { name: 'Publish website', exact: true }),
    ).toBeEnabled()
    const anonymous = await context.browser()!.newContext()
    const visitor = await anonymous.newPage()
    expect((await visitor.request.get('/sites/' + key)).status()).toBe(404)
    const preview = await context.newPage()
    await preview.goto('/sites/' + key + '?preview=1')
    await expect(preview.getByRole('heading', { name, exact: true })).toBeVisible()
    await preview.close()
    const editor = workspace.getByRole('region', { name: 'Child website settings' })
    await editor.getByLabel('Site tagline', { exact: true }).fill('Retain this input ' + stamp)
    await admin.route('**/api/organization-admin', async (route) => {
      const body = route.request().postDataJSON()
      if (route.request().method() === 'POST' && body.action === 'website-settings')
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Website settings changed. Input retained.' }),
        })
      else await route.continue()
    })
    await editor.getByRole('button', { name: 'Save website settings', exact: true }).click()
    await expect(editor.getByText('Website settings changed. Input retained.')).toBeVisible()
    await expect(editor.getByLabel('Site tagline', { exact: true })).toHaveValue(
      'Retain this input ' + stamp,
    )
    await admin.unroute('**/api/organization-admin')
    const refreshedStatus = admin.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).searchParams.get('site') === child &&
        new URL(response.url()).searchParams.has('website'),
    )
    await editor.getByRole('button', { name: 'Save website settings', exact: true }).click()
    await expect(editor.getByText('Website settings saved.')).toBeVisible()
    await (await refreshedStatus).finished()
    console.log('Website settings saved and refreshed')
    await workspace.getByRole('button', { name: 'Publish website', exact: true }).click()
    await expect(workspace.getByRole('link', { name: 'View website', exact: true })).toBeVisible()
    console.log('Child website published')
    await visitor.goto('/sites/' + key)
    await expect(visitor.getByRole('heading', { name, exact: true })).toBeVisible()
    await visitor.waitForLoadState('networkidle')
    expect(new URL(visitor.url()).pathname).toBe('/sites/' + key)
    await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp('/sites/' + key + '/?$'),
    )
    expect(
      (
        await visitor.request.get(
          '/sites/' + key + '/api/media/file/' + encodeURIComponent(childMedia.filename),
        )
      ).status(),
    ).toBe(200)
    await expect(visitor.getByRole('link', { name: 'Posts', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + key + '/posts',
    )
    const rootSlug = 'duplicate-' + stamp
    for (const [site, title] of [
      ['default', 'Primary ' + stamp],
      [child, 'Child ' + stamp],
    ]) {
      const created = await admin.request.post('/api/pages', {
        headers: { 'x-vorticause-site': site },
        data: {
          editorSite: site,
          title,
          slug: rootSlug,
          _status: 'published',
          content: {
            root: {
              type: 'root',
              children: [],
              direction: null,
              format: '',
              indent: 0,
              version: 1,
            },
          },
        },
        timeout: 120000,
      })
      expect(created.ok(), await created.text()).toBe(true)
    }
    await visitor.goto('/sites/' + key + '/' + rootSlug)
    await expect(
      visitor.getByRole('heading', { name: 'Child ' + stamp, exact: true }),
    ).toBeVisible()
    await visitor.goto('/' + rootSlug)
    await expect(
      visitor.getByRole('heading', { name: 'Primary ' + stamp, exact: true }),
    ).toBeVisible()
    const forged = await visitor.request.get('/' + rootSlug, {
      headers: { 'x-vorticause-public-site': child },
    })
    expect(await forged.text()).toContain('Primary ' + stamp)
    await workspace.getByRole('button', { name: 'Open site editor', exact: true }).click()
    await expect(admin).toHaveURL(/\/admin\/collections\/pages/)
    expect(
      (
        await page.request.get('/api/media/file/' + encodeURIComponent(parentMedia!.filename))
      ).status(),
    ).toBe(200)
    await expect(old.getByLabel('First name', { exact: true })).toHaveValue(
      'Unsaved original site ' + stamp,
    )
    const contactSaved = old.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/crm/contacts',
    )
    await old.getByRole('button', { name: 'Save contact', exact: true }).click()
    expect((await contactSaved).ok()).toBe(true)
    const rootContacts = await old.request.get(
      '/api/crm/contacts?site=default&search=' +
        encodeURIComponent('Unsaved original site ' + stamp),
    )
    expect(rootContacts.ok()).toBe(true)
    expect(
      (await rootContacts.json()).docs.some((doc: { label: string }) => doc.label.includes(stamp)),
    ).toBe(true)
    console.log('Separate-tab contact save stayed on its opened site')
    await admin.goto('/admin/sites?site=default')
    await expect(admin.getByRole('heading', { name: 'SubSites', exact: true })).toBeVisible()
    admin.once('dialog', (dialog) => dialog.accept())
    await admin.getByLabel('Enable SubSites', { exact: true }).click()
    await expect(admin.getByLabel('Enable SubSites', { exact: true })).not.toBeChecked()
    await expect.poll(async () => (await website('default')).subsites_enabled).toBe(0)
    expect((await visitor.request.get('/sites/' + key)).status()).toBe(404)
    const current = await website(child)
    const denied = await admin.request.post('/api/organization-admin', {
      headers: { Origin: origin },
      data: {
        action: 'publication',
        site: child,
        enabled: true,
        expectedRevision: current.revision,
        operationKey: crypto.randomUUID(),
      },
    })
    expect(denied.ok()).toBe(false)
    await admin.getByLabel('Enable SubSites', { exact: true }).click()
    await expect(admin.getByLabel('Enable SubSites', { exact: true })).toBeChecked()
    await expect.poll(async () => (await website('default')).subsites_enabled).toBe(1)
    expect((await visitor.request.get('/sites/' + key)).status()).toBe(200)
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin
      .getByRole('button', { name: 'Open Menu', exact: true })
      .filter({ visible: true })
      .click()
    await admin.getByRole('link', { name: 'CRM', exact: true }).click()
    await expect(admin.getByRole('region', { name: 'CRM overview', exact: true })).toBeVisible()
    await expect(admin.locator('button.nav-toggler').filter({ visible: true })).toBeVisible()
    await anonymous.close()
  } catch (error) {
    console.log('Integrated browser check failed:', error instanceof Error ? error.message : error)
    await admin
      .screenshot({ path: '.wrangler/subsites-admin-failure.png', timeout: 10000 })
      .catch(() => {})
    throw error
  } finally {
    console.log('Restoring local test preferences')
    if (previousLogo !== undefined) {
      const restore = await page.request.post('/api/globals/site-settings', {
        headers: { Origin: origin, 'x-vorticause-site': 'default' },
        data: { logo: previousLogo },
      })
      expect(restore.ok(), await restore.text()).toBe(true)
    }
    if (!primaryBefore.subsites_enabled) await toggle('default', false)
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
    await admin.close({ runBeforeUnload: false })
  }
})
