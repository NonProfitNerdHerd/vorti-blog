import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/users/login', { data: { email: 'dev@payloadcms.com', password: 'test' } })).ok()).toBe(true)
})

test('public and internal Posts and Pages use the same block editor and preserve their area through save and reload', async ({ page }) => {
  const user = (await (await page.request.get('/api/users/me')).json()).user
  const stamp = Date.now()
  for (const collection of ['posts', 'pages']) for (const audience of ['public', 'intranet']) {
    const response = await page.request.post(`/api/${collection}?site=default&audience=${audience}&draft=true`, { data: {
      title: `${audience} ${collection} editor ${stamp}`, slug: `shared-editor-${collection}-${stamp}`, author: user.id, _status: 'draft',
      contentLayout: { version: 1, nodes: [{ id: 'shared-heading', kind: 'heading', label: 'Heading', text: 'Shared editing fixture' }] },
    } })
    expect(response.ok(), await response.text()).toBe(true)
    const doc = (await response.json()).doc
    expect(doc.audience).toBe(audience)
    // A direct document link resolves the stored audience rather than relying
    // on a caller-provided sidebar filter to authorize or select the document.
    await page.goto(`/admin/collections/${collection}/${doc.id}?site=default`)
    await expect(page.locator('textarea[aria-label="Heading"]')).toHaveValue('Shared editing fixture')
    await expect(page).toHaveURL(new RegExp(`audience=${audience}`))
    const edited = `Retained ${audience} ${collection} block`
    await page.locator('textarea[aria-label="Heading"]').fill(edited)
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
    await expect.poll(async () => (await (await page.request.get(`/api/${collection}/${doc.id}?site=default&draft=true`)).json()).contentLayout?.nodes?.[0]?.text).toBe(edited)
    await page.reload()
    await expect(page.locator('textarea[aria-label="Heading"]')).toHaveValue(edited)
    const wrongMove = await page.request.patch(`/api/${collection}/${doc.id}?site=default`, { data: { audience: audience === 'public' ? 'intranet' : 'public' } })
    expect(wrongMove.status()).toBe(409)
  }
})

test('the internal portal uses its own template, news routes and protected resource directory', async ({ page, browser, baseURL }) => {
  const anonymous = await browser.newContext({ baseURL })
  try {
    const templates = async (audience: string) => (await (await page.request.get(`/api/site-templates?site=default&audience=${audience}&depth=0`)).json()).docs
    expect((await templates('public')).some((doc: { publishingTemplateRole?: string }) => doc.publishingTemplateRole === 'Main (public default)')).toBe(true)
    expect((await templates('intranet')).some((doc: { publishingTemplateRole?: string }) => doc.publishingTemplateRole === 'Intranet default')).toBe(true)
    await page.goto('/intranet')
    await expect(page.getByRole('heading', { name: 'Intranet', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Welcome to / })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Latest news', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Resource directory', exact: true })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search Intranet', exact: true })).toBeVisible()
    const user = (await (await page.request.get('/api/users/me')).json()).user, slug = `internal-news-${Date.now()}`
    const created = await page.request.post('/api/posts?site=default&audience=intranet', { data: { title: 'Internal browser news', slug, author: user.id, _status: 'published' } })
    expect(created.ok(), await created.text()).toBe(true)
    const doc = (await created.json()).doc
    await page.goto(`/intranet/posts/${slug}`)
    await expect(page.getByRole('heading', { name: 'Internal browser news', exact: true })).toBeVisible()
    expect((await anonymous.request.get(`/intranet/posts/${slug}`)).status()).toBe(404)
    expect((await anonymous.request.get(`/api/posts/${doc.id}?site=default`)).status()).toBe(404)
    const listed = await (await anonymous.request.get('/api/posts?site=default&depth=0&limit=100')).json()
    expect(listed.docs.some((item: { id: number }) => item.id === doc.id)).toBe(false)
    await page.goto('/intranet/resources')
    await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/intranet')
    await expect(page.getByRole('heading', { name: /^Welcome to / })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  } finally { await anonymous.close() }
})

test('internal sharing, protected uploads and copying use the shared document interface', async ({ page, browser, baseURL }) => {
  const user = (await (await page.request.get('/api/users/me')).json()).user, stamp = Date.now()
  const created = await page.request.post('/api/posts?site=default&audience=intranet&draft=true', { data: {
    title: 'Internal sharing browser fixture', slug: `sharing-browser-${stamp}`, author: user.id, _status: 'draft',
    contentLayout: { version: 1, nodes: [{ id: 'sharing-heading', kind: 'heading', label: 'Heading', text: 'Shared document controls' }] },
  } })
  expect(created.ok(), await created.text()).toBe(true)
  const doc = (await created.json()).doc
  await page.goto(`/admin/collections/posts/${doc.id}?site=default&audience=intranet`)
  await page.getByRole('tab', { name: 'Document settings', exact: true }).click()
  await page.getByRole('button', { name: 'Manage readership', exact: true }).click()
  const sharing = page.getByRole('dialog', { name: 'Manage Intranet readership', exact: true })
  await sharing.getByLabel('Who can read this document?').selectOption('restricted')
  await expect(sharing.getByText(/Empty selections stay restricted/)).toBeVisible()
  await sharing.getByRole('button', { name: 'Save readership', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get(`/api/publishing/sharing?site=default&collection=posts&id=${doc.id}`)).json()).readership).toBe('restricted')
  const upload = await page.request.post('/api/media?site=default&audience=intranet', {
    headers: { 'x-vorticause-publishing-parent': JSON.stringify({ collection: 'posts', id: doc.id }) },
    multipart: { _payload: JSON.stringify({ alt: 'Private browser attachment', audience: 'intranet' }), file: { name: 'private-browser.txt', mimeType: 'text/plain', buffer: Buffer.from('private browser bytes') } },
  })
  expect(upload.ok(), await upload.text()).toBe(true)
  const media = (await upload.json()).doc
  const downloaded = await page.request.get(media.url)
  expect(downloaded.ok(), await downloaded.text()).toBe(true)
  expect(await downloaded.text()).toBe('private browser bytes')
  const anonymous = await browser.newContext({ baseURL })
  try {
    expect((await anonymous.request.get(media.url)).status()).toBe(404)
    expect((await anonymous.request.get(`/api/media/${media.id}?site=default`)).status()).toBe(404)
    expect((await anonymous.request.get(`/api/media/file/${encodeURIComponent(media.filename)}?prefix=${encodeURIComponent(media.prefix)}`)).ok()).toBe(false)
  } finally { await anonymous.close() }
  await page.goto(`/admin/collections/posts/${doc.id}?site=default&audience=intranet`)
  await page.getByRole('tab', { name: 'Document settings', exact: true }).click()
  await page.getByRole('button', { name: 'Copy or move to Public', exact: true }).click()
  const copying = page.getByRole('dialog', { name: 'Copy or move content', exact: true })
  await copying.getByLabel('Destination slug').fill(`public-copy-${stamp}`)
  await copying.getByRole('button', { name: 'Create destination draft', exact: true }).click()
  await expect(page).toHaveURL(/audience=public/)
  await expect(page.locator('textarea[aria-label="Heading"]')).toHaveValue('Shared document controls')
  const copiedID = new URL(page.url()).pathname.split('/').at(-1)
  const copied = await (await page.request.get(`/api/posts/${copiedID}?site=default&draft=true`)).json()
  expect(copied).toMatchObject({ audience: 'public', _status: 'draft' })
  expect(Number(copiedID)).not.toBe(doc.id)
})
