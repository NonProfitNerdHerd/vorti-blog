import { expect, test } from '@playwright/test'
test.use({ actionTimeout: 20000 })
test('visual menu editing, nested rows, public placements, stale saves and responsive navigation', async ({
  page,
  request,
}) => {
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const create = async (collection: string, data: object) => {
    const response = await page.request.post(`/api/${collection}?depth=0`, { data })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc
  }
  const stamp = Date.now(),
    menuName = `Community menu ${stamp}`
  const destination = await create('pages', {
    title: `About ${stamp}`,
    slug: `menu-about-${stamp}`,
    _status: 'published',
  })
  await page.goto('/admin/globals/navigation')
  await expect(page.getByRole('heading', { name: 'Menus', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '+ Create menu', exact: true }).click()
  await page.getByLabel('Menu name', { exact: true }).fill(menuName)
  await page.getByLabel('Search pages', { exact: true }).fill(`About ${stamp}`)
  await page.getByRole('checkbox', { name: `About ${stamp}`, exact: true }).check()
  await page.getByRole('button', { name: 'Add to menu (1)', exact: true }).click()
  await page.getByRole('tab', { name: 'Custom links' }).click()
  await page.getByLabel('Link text', { exact: true }).fill('Team')
  await page.getByLabel('URL', { exact: true }).fill('/team')
  await page.getByRole('button', { name: 'Add to menu', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Team', exact: true }).click()
  await page.getByRole('button', { name: 'Indent', exact: true }).click()
  const team = page
    .locator('.menus-workspace__structure li')
    .filter({ has: page.locator('strong', { hasText: 'Team' }) })
  await expect(team).toHaveCSS('margin-left', '24px')
  await page.getByRole('checkbox', { name: 'Open in new tab', exact: true }).check()
  await page.getByRole('button', { name: 'Edit Team', exact: true }).click()
  await page.getByLabel('Link text', { exact: true }).fill('Resources')
  await page.getByLabel('URL', { exact: true }).fill('https://example.com/resources')
  await page.getByRole('button', { name: 'Add to menu', exact: true }).click()
  const rows = page.locator('.menus-workspace__row')
  const resourceRow = rows.filter({ has: page.locator('strong', { hasText: 'Resources' }) })
  const aboutRow = rows.filter({ has: page.locator('strong', { hasText: `About ${stamp}` }) })
  await resourceRow.dragTo(aboutRow, { targetPosition: { x: 5, y: 5 } })
  await expect(rows.first().locator('strong')).toHaveText('Resources')
  await page.getByRole('button', { name: 'Edit Resources', exact: true }).click()
  await page.getByRole('button', { name: 'Move down', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Resources', exact: true }).click()
  await expect(rows.first().locator('strong')).toHaveText(`About ${stamp}`)
  await page.getByRole('button', { name: 'Save menu', exact: true }).first().click()
  await expect(page.locator('.menus-workspace__success')).toContainText(`${menuName} was saved`)
  const menuID = Number(new URL(page.url()).searchParams.get('menu'))
  expect(menuID).toBeGreaterThan(0)
  const rendered = await page.request.get(`/api/menu-render/${menuID}`)
  const resolved = await rendered.json()
  expect(resolved.items[0].children[0]).toMatchObject({ label: 'Team', newTab: true })
  await page.getByText('Default locations', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Primary', exact: true }).selectOption(String(menuID))
  await page.getByRole('button', { name: 'Save locations', exact: true }).click()
  await expect(page.locator('.menus-workspace__success')).toContainText('Menu locations were saved')
  await expect(page.getByRole('combobox', { name: 'Primary', exact: true })).toHaveValue(
    String(menuID),
  )
  await page.getByRole('combobox', { name: 'Footer', exact: true }).selectOption(String(menuID))
  await page.getByRole('button', { name: 'Save locations', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Footer', exact: true })).toHaveValue(
    String(menuID),
  )
  await expect(page.getByRole('button', { name: 'Save locations', exact: true })).toBeDisabled()
  await page.screenshot({ path: '.wrangler/menus-editor-light.png', fullPage: true })
  const surface = await create('pages', {
    title: 'Menu placement',
    slug: `menu-surface-${stamp}`,
    _status: 'published',
    contentLayout: {
      version: 1,
      nodes: [
        {
          id: 'first-menu',
          kind: 'menu',
          props: { menuID: String(menuID), depth: 1, label: 'Shallow menu', mobile: 'expanded' },
        },
        {
          id: 'second-menu',
          kind: 'menu',
          props: {
            menuID: String(menuID),
            depth: 5,
            label: 'Full menu',
            orientation: 'vertical',
            mobile: 'expanded',
          },
        },
      ],
    },
  })
  const html = await (await page.request.get(`/${surface.slug}`)).text()
  expect(html).toContain('href="/team"')
  expect(html).not.toContain('Loading menu')
  await page.goto(`/${surface.slug}`)
  const shallow = page.getByRole('navigation', { name: 'Shallow menu', exact: true }),
    full = page.getByRole('navigation', { name: 'Full menu', exact: true })
  await expect(shallow.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0)
  await full.locator('.vc-menu__desktop').getByLabel(`Expand About ${stamp} submenu`).click()
  await expect(
    full.locator('.vc-menu__desktop').getByRole('link', { name: 'Team', exact: true }),
  ).toBeVisible()
  const parentBox = await full
    .locator('.vc-menu__desktop')
    .getByRole('link', { name: `About ${stamp}`, exact: true })
    .boundingBox()
  const childBox = await full
    .locator('.vc-menu__desktop')
    .getByRole('link', { name: 'Team', exact: true })
    .boundingBox()
  expect(childBox!.y).toBeGreaterThanOrEqual(parentBox!.y + parentBox!.height)
  expect(childBox!.x).toBeGreaterThan(parentBox!.x)
  await expect(
    full.locator('.vc-menu__desktop').getByRole('link', { name: 'Team', exact: true }),
  ).toHaveCSS('color', 'rgb(26, 26, 26)')
  await page.screenshot({ path: '.wrangler/menus-public.png', fullPage: true })
  await full
    .locator('.vc-menu__desktop')
    .getByLabel(`Expand About ${stamp} submenu`)
    .press('Escape')
  await expect(
    full.locator('.vc-menu__desktop').getByRole('link', { name: 'Team', exact: true }),
  ).not.toBeVisible()
  await page.goto(`/admin/globals/navigation?menu=${menuID}`)
  await page.getByRole('button', { name: 'Edit Resources', exact: true }).click()
  await page.getByLabel('Navigation label', { exact: true }).fill('Our resources')
  const previous = await (await page.request.get(`/api/menus/${menuID}?depth=0`)).json()
  const remote = await page.request.patch(`/api/menus/${menuID}`, {
    data: { name: menuName, expectedUpdatedAt: previous.updatedAt },
  })
  expect(remote.ok(), await remote.text()).toBe(true)
  await page.getByRole('button', { name: 'Save menu', exact: true }).first().click()
  await expect(page.locator('.menus-workspace__error')).toContainText('changed')
  await expect(page.getByLabel('Navigation label', { exact: true })).toHaveValue('Our resources')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: '+ Create menu', exact: true }).click()
  await expect(page.getByLabel('Navigation label', { exact: true })).toHaveValue('Our resources')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Reload saved menus', exact: true }).click()
  await expect(page.getByLabel('Menu name', { exact: true })).toHaveValue(menuName)
  await page
    .context()
    .addCookies([{ name: 'payload-theme', value: 'dark', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByLabel('Menu name', { exact: true })).toHaveValue(menuName)
  await page.screenshot({ path: '.wrangler/menus-editor-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
      timeout: 5000,
    })
    .toBe(true)
  await page.screenshot({ path: '.wrangler/menus-editor-mobile.png', fullPage: true })
  await page.goto(`/${surface.slug}`)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
      timeout: 5000,
    })
    .toBe(true)
  await expect(page.getByRole('navigation', { name: 'Full menu', exact: true })).toBeVisible()
  const anon = await request.get('/api/menus?limit=1')
  expect([401, 403]).toContain(anon.status())
  const menu = await (await page.request.get(`/api/menus/${menuID}?depth=0`)).json()
  const renamed = await page.request.patch(`/api/menus/${menuID}`, {
    data: {
      items: menu.items.map((item: { key: string; label: string }) => ({
        ...item,
        label: item.label === 'Resources' ? 'Updated resources' : item.label,
      })),
      expectedUpdatedAt: menu.updatedAt,
    },
  })
  expect(renamed.ok(), await renamed.text()).toBe(true)
  await page.reload()
  await expect(
    page
      .getByRole('navigation', { name: 'Full menu', exact: true })
      .getByRole('link', { name: 'Updated resources', exact: true }),
  ).toBeVisible()
  await page.request.delete(`/api/menus/${menuID}`)
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Full menu', exact: true })).toHaveCount(0)
  await page.request.delete(`/api/pages/${surface.id}`)
  await page.request.delete(`/api/pages/${destination.id}`)
})
