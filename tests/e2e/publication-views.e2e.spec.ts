import { expect, test } from '@playwright/test'
test.use({ actionTimeout: 20000 })
test('Posts and Pages publication views and native bulk icons', async ({ page }) => {
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const stamp = Date.now(),
    now = new Date(),
    day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
  const create = async (collection: string, data: object) => {
    const response = await page.request.post(`/api/${collection}`, { data })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc
  }
  for (const collection of ['posts', 'pages']) {
    const doc = await create(collection, {
      title: `Calendar ${collection} ${stamp}`,
      slug: `calendar-${collection}-${stamp}`,
      publishedAt: `${day}T12:00:00Z`,
      _status: 'published',
      contentLayout: {
        version: 1,
        nodes: [{ id: 'p', kind: 'paragraph', text: 'Calendar fixture' }],
      },
    })
    const missing = await create(collection, {
      title: `Undated ${collection} ${stamp}`,
      slug: `undated-${collection}-${stamp}`,
      _status: 'draft',
    })
    await page.goto(`/admin/collections/${collection}`)
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: doc.title, exact: true }) })
    await row.getByRole('checkbox').check()
    for (const label of ['Edit', 'Publish', 'Unpublish', 'Delete']) {
      const action = page
        .locator(
          '.collection-list__header, .collection-list__list-selection, .collection-list__wrap',
        )
        .getByRole('button', { name: label, exact: true })
        .first()
      await expect(action).toBeVisible()
      await expect(action.locator('.btn__label')).toHaveCSS('clip-path', 'inset(50%)')
    }
    await row.getByRole('checkbox').uncheck()
    await page
      .getByRole('navigation', { name: 'Content views' })
      .getByRole('button', { name: 'Calendar', exact: true })
      .click()
    const calendar = page.getByRole('region', { name: 'Publication calendar', exact: true })
    await expect(calendar.getByRole('link', { name: new RegExp(doc.title) })).toBeVisible()
    await expect(calendar.getByRole('link', { name: missing.title, exact: true })).toBeVisible()
    await page.screenshot({
      path: `.wrangler/publication-${collection}-calendar.png`,
      fullPage: true,
    })
    await calendar.getByRole('button', { name: 'Day', exact: true }).click()
    await expect(page).toHaveURL(/calendarMode=day/)
    await calendar.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(page).toHaveURL(/calendarMode=week/)
    await calendar.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(page).toHaveURL(/calendarMode=month/)
    await calendar.getByRole('button', { name: 'Next period', exact: true }).click()
    await expect(calendar).toContainText('No dated publications')
    await calendar.getByRole('button', { name: 'Previous period', exact: true }).click()
    await expect(calendar.getByRole('link', { name: new RegExp(doc.title) })).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Content views' })
      .getByRole('button', { name: 'Gantt', exact: true })
      .click()
    await expect(
      page
        .getByRole('region', { name: 'Publication Gantt' })
        .getByRole('link', { name: doc.title, exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByRole('region', { name: 'Publication Gantt' })).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Content views' })
      .getByRole('button', { name: 'List', exact: true })
      .click()
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: doc.title, exact: true }) }),
    ).toBeVisible()
    await page.request.delete(`/api/${collection}/${doc.id}`)
    await page.request.delete(`/api/${collection}/${missing.id}`)
  }
})

test('page-local Tasks menu, design order and mobile content views', async ({ page }) => {
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  await page.goto('/admin')
  const nav = page.locator('.nav__wrap'),
    toggle = nav.getByRole('button', { name: 'Toggle Tasks navigation' })
  try {
    await expect(toggle).toBeVisible({ timeout: 3000 })
  } catch {
    await page.getByRole('button', { name: 'Open Menu', exact: true }).click()
  }
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
  await expect(nav.getByRole('link', { name: 'My tasks', exact: true })).not.toBeVisible()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(nav.getByRole('link', { name: 'My tasks', exact: true })).toBeVisible()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const design = nav.getByRole('button', { name: 'Site Design', exact: true })
  if (!(await nav.getByRole('link', { name: 'Page/Post Templates', exact: true }).isVisible()))
    await design.click()
  const order = await page.locator('#nav-group-Site\\ Design .nav__link-label').allTextContents()
  expect(order.slice(0, 2)).toEqual(['Page/Post Templates', 'Site Templates'])
  if (!(await nav.getByRole('link', { name: 'Site Settings', exact: true }).isVisible()))
    await nav.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(
    page.locator('#nav-group-Admin').getByRole('link', { name: 'Site Settings', exact: true }),
  ).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin/collections/pages?contentView=calendar')
  await expect(page.getByRole('region', { name: 'Publication calendar' })).toBeVisible()
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: '.wrangler/publication-mobile-dark.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
