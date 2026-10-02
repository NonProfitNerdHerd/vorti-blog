import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(response.ok()).toBeTruthy()
})

for (const collection of ['posts', 'pages'])
  test(`${collection}: create, style, nest, undo, save, reload and publish`, async ({ page }) => {
    const suffix = `${collection}-${Date.now()}`
    await page.goto(`/admin/collections/${collection}/create`)
    const workspace = page.locator('.content-workspace')
    const library = workspace.locator('.content-workspace__left')
    await library.getByRole('button', { name: 'Heading', exact: true }).click()
    await workspace.locator('textarea[aria-label="Heading"]').fill('A styled heading')
    await expect(workspace.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await workspace.locator('.content-workspace__right').getByText('Style', { exact: true }).click()
    await workspace.getByRole('textbox', { name: 'backgroundColor', exact: true }).fill('#ffeecc')
    await workspace.getByRole('textbox', { name: 'backgroundColor', exact: true }).press('Tab')
    await workspace.getByRole('textbox', { name: 'padding', exact: true }).fill('24px')
    await workspace.getByRole('textbox', { name: 'padding', exact: true }).press('Tab')
    await expect(workspace.locator('[data-block-kind=heading]')).toHaveCSS(
      'background-color',
      'rgb(255, 238, 204)',
    )
    await library.getByRole('button', { name: 'Columns', exact: true }).click()
    await workspace.locator('textarea[aria-label="Heading"]').click()
    const move = workspace.getByRole('combobox', { name: 'Move block into', exact: true })
    const firstColumn = await move
      .locator('option')
      .filter({ hasText: /^column$/ })
      .first()
      .getAttribute('value')
    await move.selectOption(firstColumn!)
    await expect(
      workspace.locator('[data-block-kind=columns] [data-block-kind=heading]'),
    ).toHaveCount(1)
    await workspace.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(
      workspace.locator('[data-block-kind=columns] [data-block-kind=heading]'),
    ).toHaveCount(0)
    await workspace.getByRole('button', { name: 'Redo', exact: true }).click()
    await workspace.getByRole('tab', { name: 'Document settings', exact: true }).click()
    await workspace.locator('input[name=title]').fill(`Editor ${suffix}`)
    await workspace.locator('input[name=slug]').fill(suffix)
    if (collection === 'posts') {
      await workspace
        .locator('.content-workspace__right input[role=combobox]')
        .nth(2)
        .fill('dev@payloadcms.com')
      await page.getByRole('option', { name: 'dev@payloadcms.com', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
    await page.waitForURL(new RegExp(`/collections/${collection}/\\d+`))
    const id = page.url().split('/').at(-1)
    await page.reload()
    await expect(workspace.locator('textarea[aria-label="Heading"]')).toHaveValue(
      'A styled heading',
    )
    const saved = await (await page.request.get(`/api/${collection}/${id}?draft=true`)).json()
    expect(saved.contentLayout.version).toBe(1)
    expect(saved.contentLayout.nodes[0].kind).toBe('columns')
    expect(saved.contentLayout.nodes[0].children[0].children[0].styles.desktop.padding).toBe('24px')
    await page.getByRole('button', { name: /Publish changes/i }).click()
    await expect
      .poll(async () => (await (await page.request.get(`/api/${collection}/${id}`)).json())._status)
      .toBe('published')
    await page.goto(collection === 'posts' ? `/posts/${suffix}` : `/${suffix}`)
    await expect(page.getByRole('heading', { name: 'A styled heading', exact: true })).toBeVisible()
    await expect(page.locator('[data-block-kind=heading]')).toHaveCSS(
      'background-color',
      'rgb(255, 238, 204)',
    )
    await expect(page.locator('[data-block-kind=heading]')).toHaveCSS('padding-top', '24px')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => page.locator('[data-block-kind=columns]').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
  })

test('templates lock structure and styles, keep fields editable, and enforce the same rule through the API', async ({
  page,
}) => {
  const suffix = `locked-${Date.now()}`
  const templateResponse = await page.request.post('/api/design-templates', {
    data: {
      name: suffix,
      slug: suffix,
      status: 'published',
      _status: 'published',
      allowedCollections: ['pages'],
      sections: [],
      layout: [
        {
          id: 'intro',
          type: 'field',
          fieldType: 'longText',
          label: 'Introduction',
          required: true,
          content: { source: 'custom' },
        },
        {
          id: 'static',
          type: 'field',
          fieldType: 'shortText',
          label: 'Static heading',
          content: { source: 'static', value: 'Template heading' },
        },
      ],
    },
  })
  expect(templateResponse.ok(), await templateResponse.text()).toBeTruthy()
  const template = (await templateResponse.json()).doc
  const created = await page.request.post('/api/pages', {
    data: {
      title: suffix,
      slug: suffix,
      designTemplate: template.id,
      templateValues: { intro: 'Original' },
      _status: 'draft',
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const document = (await created.json()).doc
  await page.goto(`/admin/collections/pages/${document.id}`)
  const workspace = page.locator('.content-workspace')
  await expect(workspace.locator('.content-workspace__center textarea')).toHaveValue('Original')
  await workspace.locator('.content-workspace__center textarea').fill('Updated through the canvas')
  await expect(workspace.getByRole('tab', { name: 'Blocks', exact: true })).toHaveCount(0)
  await expect(workspace.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0)
  await expect(
    workspace.locator('.content-workspace__right').getByText('Style', { exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/pages/${document.id}?draft=true`)).json())
          .templateValues.intro,
    )
    .toBe('Updated through the canvas')
  await page.reload()
  await expect(workspace.locator('.content-workspace__center textarea')).toHaveValue(
    'Updated through the canvas',
  )
  for (const data of [
    { designOverrides: { intro: 1 } },
    { responsiveDesigns: { intro: { mobile: 1 } } },
    {
      contentLayout: { version: 1, nodes: [{ id: 'injected', kind: 'paragraph', text: 'Bypass' }] },
    },
  ]) {
    const rejected = await page.request.patch(`/api/pages/${document.id}`, { data })
    expect(rejected.ok()).toBeFalsy()
  }
  await workspace.getByRole('tab', { name: 'Document settings', exact: true }).click()
  page.once('dialog', (dialog) => dialog.dismiss())
  await workspace.getByRole('combobox', { name: 'Template', exact: true }).selectOption('')
  await expect(workspace.getByRole('combobox', { name: 'Template', exact: true })).toHaveValue(
    String(template.id),
  )
  const invalid = await page.request.patch(`/api/pages/${document.id}`, {
    data: { _status: 'published', templateValues: { intro: '' } },
  })
  expect(invalid.status()).toBe(400)
  expect(JSON.stringify(await invalid.json())).toContain('templateValues.intro')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(workspace.getByRole('button', { name: 'Inspector', exact: true })).toBeVisible()
})

test('rich text formatting and responsive styles survive save and appear in draft preview', async ({
  page,
}) => {
  const suffix = `rich-${Date.now()}`
  await page.goto('/admin/collections/pages/create')
  const workspace = page.locator('.content-workspace')
  await workspace
    .locator('.content-workspace__left')
    .getByRole('button', { name: 'Paragraph', exact: true })
    .click()
  await workspace.locator('textarea[aria-label=Paragraph]').fill('Rich text preview')
  await workspace.getByRole('button', { name: 'Format text', exact: true }).click()
  const editable = workspace.locator('[contenteditable=true]').first()
  await expect(editable).toContainText('Rich text preview')
  await editable.click()
  await editable.press('Control+a')
  await editable.press('Control+b')
  await expect(editable.locator('strong')).toContainText('Rich text preview')
  await workspace.getByRole('combobox', { name: 'Preview width' }).selectOption('mobile')
  await workspace.locator('.content-workspace__right').getByText('Style', { exact: true }).click()
  await workspace.getByRole('textbox', { name: 'padding', exact: true }).fill('8px')
  await workspace.getByRole('textbox', { name: 'padding', exact: true }).press('Tab')
  await expect(workspace.locator('[data-block-kind=paragraph]')).toHaveCSS('padding-top', '8px')
  await workspace.getByRole('tab', { name: 'Document settings', exact: true }).click()
  await workspace.locator('input[name=title]').fill(suffix)
  await workspace.locator('input[name=slug]').fill(suffix)
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await page.waitForURL(/collections\/pages\/\d+/)
  const id = page.url().split('/').at(-1)
  const saved = await (await page.request.get(`/api/pages/${id}?draft=true`)).json()
  expect(saved.contentLayout.nodes[0].richText.root.children[0].children[0].format).not.toBe(0)
  const resolved = await page.request.post('/api/content-design-preview', { data: saved })
  expect(resolved.ok()).toBeTruthy()
  expect((await resolved.json())[0].node.styles.mobile.padding).toBe('8px')
  await page.goto(`/${suffix}?livePreview=${id}`)
  await expect(page.getByText('Rich text preview', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-block-kind=paragraph]')).toHaveCSS('padding-top', '8px')
})
