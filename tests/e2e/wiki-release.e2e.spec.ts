import { expect, test } from '@playwright/test'

test('Wiki article, editor, history, attachments, conflicts and responsive contents share the existing system session', async ({
  page,
  browser,
  baseURL,
}) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBe(true)
  const endpoint = '/api/knowledge?site=default&kind=wiki',
    headers = { Origin: baseURL! },
    id = `wiki-design-${Date.now()}`
  const text = (value: string) => ({
    type: 'text',
    version: 1,
    text: value,
    format: 0,
    style: '',
    mode: 'normal',
    detail: 0,
  })
  const block = (type: string, value: string, tag?: string) => ({
    type,
    version: 1,
    ...(tag ? { tag } : {}),
    children: [text(value)],
    direction: null as null,
    format: '',
    indent: 0,
  })
  const body = {
    root: {
      type: 'root',
      version: 1,
      children: [
        block('paragraph', 'A recognizable reference article.'),
        block('heading', 'Overview', 'h2'),
        block('paragraph', 'The shared knowledge library.'),
        block('heading', 'Details', 'h4'),
        block('heading', 'Overview', 'h3'),
      ],
      direction: null as null,
      format: '',
      indent: 0,
    },
  }
  const draft = {
    id,
    parent: null as string | null,
    title: 'Wiki design reference',
    slug: id,
    body,
    visibility: 'public',
  }
  const save = async (data: object) => {
    const response = await page.request.post(endpoint, {
      headers,
      data: { ...data, operationKey: crypto.randomUUID() },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await save({ ...draft, action: 'save', expectedRevision: 0 })
  await save({ ...draft, action: 'publish', expectedRevision: 1 })
  const path = `/wiki/${id}/${id}`
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: draft.title })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Log out', exact: true })).toBeVisible()
  await expect(page.locator('h4#wiki-details')).toHaveText('Details')
  await page
    .getByRole('navigation', { name: 'Article contents' })
    .getByRole('link', { name: 'Overview', exact: true })
    .nth(1)
    .click()
  await expect(page).toHaveURL(/#wiki-overview-2$/)
  await page.screenshot({ path: '.wrangler/wiki-release/wiki-article-desktop.png', fullPage: true })
  await page.getByRole('link', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(/view=edit/)
  await expect(page.getByRole('textbox', { name: 'Page content' })).toContainText(
    'A recognizable reference article.',
  )
  await page.getByLabel('Title', { exact: true }).fill('Unsaved reference')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('link', { name: 'Read', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved reference')
  await page.getByLabel('Title', { exact: true }).fill('Updated wiki reference')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Page saved.')
  await page.reload()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Updated wiki reference')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Page saved.')
  const upload = await page.request.post(
    `/api/knowledge/attachments?site=default&kind=wiki&id=${id}`,
    {
      headers,
      multipart: {
        file: {
          name: 'wiki-manual.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Wiki attachment acceptance'),
        },
      },
    },
  )
  expect(upload.ok(), await upload.text()).toBe(true)
  await page.reload()
  await expect(page.getByRole('link', { name: 'wiki-manual.txt' })).toBeVisible()
  const latest = (await (await page.request.get(`${endpoint}&id=${id}&draft=1`)).json()).doc
  await save({
    ...latest,
    action: 'save',
    expectedRevision: latest.revision,
    title: 'Concurrent change',
  })
  await page.getByLabel('Title', { exact: true }).fill('Retained conflict draft')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Your draft is retained')
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Retained conflict draft')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Revision history' })).toBeVisible()
  await expect(page.locator('.wiki-revision')).not.toHaveCount(0)
  await page.getByRole('link', { name: 'Read', exact: true }).click()
  await page.getByRole('searchbox').fill('Updated wiki')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Page hierarchy' })).toContainText(
    'Updated wiki reference',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.wiki-navigation details')).not.toHaveAttribute('open')
  await page.locator('.wiki-navigation summary').click()
  await expect(page.getByRole('link', { name: 'Wiki home', exact: true })).toBeVisible()
  await page.locator('.wiki-contents summary').click()
  await expect(page.getByRole('navigation', { name: 'Article contents' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: '.wrangler/wiki-release/wiki-article-mobile.png', fullPage: true })
  const anonymous = await browser.newContext({ baseURL })
  try {
    const anon = await anonymous.newPage()
    await anon.goto(path)
    await expect(anon.getByRole('heading', { level: 1 })).toHaveText('Updated wiki reference')
    await expect(anon.getByRole('link', { name: 'Log in', exact: true })).toHaveAttribute(
      'href',
      /\/admin\/login\?redirect=/,
    )
    await anon.goto(path + '?view=edit')
    await expect(anon).toHaveURL(/\/admin\/login\?redirect=/)
    await anon.getByLabel('Email', { exact: true }).fill('dev@payloadcms.com')
    await anon.getByLabel('Password', { exact: true }).fill('test')
    await anon.getByRole('button', { name: /log in/i }).click()
    await expect(anon.getByLabel('Title', { exact: true })).toBeVisible()
    await expect(anon).toHaveURL(/\/wiki\/.*view=edit/)
  } finally {
    await anonymous.close()
  }
})

test('shared login rejects external return navigation and expired sessions cannot open the editor', async ({
  page,
}) => {
  await page.goto('/admin/login?redirect=https%3A%2F%2Fevil.invalid%2Fwiki')
  await page.getByLabel('Email', { exact: true }).fill('dev@payloadcms.com')
  await page.getByLabel('Password', { exact: true }).fill('test')
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page).toHaveURL(/\/admin(?:\?|$|\/)/)
  await page.context().clearCookies()
  await page.goto('/wiki?view=edit&new=1')
  await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
})
