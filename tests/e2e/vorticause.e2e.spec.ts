import { expect, test } from '@playwright/test'
test.use({ actionTimeout: 20000 })

test('VortiPress branding, module navigation and authorized workspace Dashboard', async ({
  page,
}) => {
  await page.goto('/admin/login')
  await expect(page.locator('.vorticause-wordmark')).toHaveText('VortiPress')
  await expect(page).toHaveTitle(/VortiPress/)
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    'content',
    'VortiPress',
  )
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    'href',
    /vortipress-icon\.svg/,
  )
  await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  const create = async (collection: string, data: object) => {
    const response = await page.request.post(`/api/${collection}?depth=0`, { data })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).doc
  }
  const stamp = Date.now()
  const project = await create('task-projects', {
    name: `Community ${stamp}`,
    visibility: 'private',
  })
  const board = await create('task-boards', {
    name: `Outreach ${stamp}`,
    project: project.id,
    inheritProject: true,
  })
  await create('task-board-preferences', { board: board.id, favorite: true, iconColor: 'teal' })
  await page.goto('/admin')
  await expect(page.locator('.vp-dashboard__summary')).toContainText('Active projects')
  await expect(page.locator('.vp-dashboard__summary')).toContainText('Active boards')
  const projects = page.getByRole('region', { name: 'Projects', exact: true })
  const boards = page.getByRole('region', { name: 'Boards', exact: true })
  await expect(projects.getByRole('link', { name: project.name, exact: true })).toHaveAttribute(
    'href',
    new RegExp(`project=${project.id}`),
  )
  await expect(boards.getByRole('link', { name: board.name, exact: true })).toBeVisible()
  await boards.getByRole('button', { name: 'Favorites', exact: true }).click()
  const color = boards.getByRole('button', {
    name: `Change personal color for ${board.name}`,
    exact: true,
  })
  await expect(color).toHaveCSS('background-color', 'rgb(15, 118, 110)')
  await expect(boards).toContainText(project.name)
  if (!(await page.locator('.nav').getAttribute('class'))?.includes('nav--nav-open'))
    await page.getByRole('button', { name: 'Open Menu', exact: true }).click()
  const nav = page.locator('.nav__wrap')
  await expect(page.locator('.nav')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await nav.getByRole('link', { name: 'Content', exact: true }).hover()
  await expect(page.getByRole('navigation', { name: 'Content sections' }).getByRole('link', { name: 'Posts' })).toBeVisible()
  await page.screenshot({ path: '.wrangler/vorticause-dashboard-light.png', fullPage: true })
  await page
    .context()
    .addCookies([{ name: 'payload-theme', value: 'dark', url: new URL(page.url()).origin }])
  await page.reload()
  await expect(projects.getByRole('link', { name: project.name, exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.nav')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await page.screenshot({ path: '.wrangler/vorticause-dashboard-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { timeout: 5000 }).toBe(true)
  await page.getByRole('banner').getByRole('button', { name: 'Open Menu', exact: true }).click()
  const taskParent = nav.getByRole('link', { name: 'Tasks', exact: true })
  await expect(taskParent).toBeVisible()
  await expect(page.locator('.nav')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await page.screenshot({ path: '.wrangler/vorticause-navigation-mobile.png', fullPage: true })
  await taskParent.click()
  await expect(page).toHaveURL(/workspace=inbox/)
  await page.getByRole('button', { name: 'Tasks menu' }).click()
  await page.getByRole('navigation', { name: 'Tasks sections' }).getByRole('link', { name: 'My tasks' }).click()
  await expect(page).toHaveURL(/taskView=assigned/)
  await expect(page.locator('.nav')).not.toHaveClass(/nav--nav-open/)
  const uploaded = await page.request.post('/api/media', {
    multipart: {
      _payload: JSON.stringify({ alt: 'Community icon' }),
      file: {
        name: `community-icon-${stamp}.svg`,
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="green"/></svg>',
        ),
      },
    },
  })
  expect(uploaded.ok(), await uploaded.text()).toBe(true)
  const media = (await uploaded.json()).doc
  const response = await page.request.post('/api/globals/site-settings', {
    data: { siteName: 'Community Site', defaultSeoTitle: 'Community Site', favicon: media.id },
  })
  expect(response.ok(), await response.text()).toBe(true)
  await page.goto('/')
  await expect(page).toHaveTitle(/Community Site/)
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /community-icon-/)
})

