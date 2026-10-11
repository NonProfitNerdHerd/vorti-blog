import { createContentNode } from '../../packages/payload-design-core/src/content/model'
import { listBlockDefinitions } from '../../packages/payload-design-core/src/blocks/registry'
import {
  toTemplateBlock,
  toShellBlock,
} from '../../packages/payload-design-core/src/blocks/adapters'
import { expect, test } from '@playwright/test'

test('shared sidebar navigates outlines, inserts precisely, duplicates and restores focus', async ({
  page,
}) => {
  await page.goto('/admin/collections/pages/create')
  const workspace = page.locator('.content-workspace')
  const sidebar = workspace.locator('.builder-sidebar')
  await expect(sidebar.getByRole('tab', { name: 'List View', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await workspace.getByRole('button', { name: 'Add block', exact: true }).click()
  await sidebar.getByRole('textbox', { name: 'Search blocks' }).fill('heading')
  await sidebar.getByRole('button', { name: 'Heading', exact: true }).click()
  await workspace.locator('textarea[aria-label=Heading]').fill('A useful heading')
  await sidebar.getByRole('tab', { name: 'Outline' }).click()
  await expect(sidebar).toContainText('3 words')
  await sidebar.getByRole('button', { name: 'H2 A useful heading' }).click()
  await workspace.getByRole('button', { name: 'Add block', exact: true }).click()
  await sidebar.getByRole('textbox', { name: 'Search blocks' }).fill('paragraph')
  await sidebar.getByRole('button', { name: 'Paragraph', exact: true }).click()
  await workspace.locator('textarea[aria-label=Paragraph]').fill('Some paragraph text')
  const drag = await sidebar
    .getByRole('button', { name: 'Drag Paragraph', exact: true })
    .boundingBox()
  const drop = await sidebar.locator('[aria-label="Insert before Heading"]').boundingBox()
  expect(drag && drop).toBeTruthy()
  await page.mouse.move(drag!.x + drag!.width / 2, drag!.y + drag!.height / 2)
  await page.mouse.down()
  await page.mouse.move(drop!.x + drop!.width / 2, drop!.y + drop!.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(
    workspace.locator('.content-workspace__viewport [data-block-kind]').first(),
  ).toHaveAttribute('data-block-kind', 'paragraph')
  await sidebar.getByRole('button', { name: 'Actions for Paragraph' }).click()
  await sidebar.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(workspace.locator('textarea[aria-label=Paragraph]')).toHaveCount(2)
  await page.screenshot({ path: '.wrangler/sidebar-list-view.png' })
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(workspace.locator('textarea[aria-label=Paragraph]')).toHaveCount(1)
  await workspace.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(workspace.locator('textarea[aria-label=Paragraph]')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  const opener = workspace.getByRole('button', { name: 'List View', exact: true })
  await opener.click()
  await sidebar.getByRole('tab', { name: 'Outline' }).press('Escape')
  await expect(sidebar).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('Site Template Header and Footer use only tabs and save their hidden groups', async ({
  page,
}) => {
  const name = `sidebar-shell-${Date.now()}`
  const created = await page.request.post('/api/site-templates', {
    data: {
      name,
      slug: name,
      _status: 'draft',
      header: { layout: [], settings: { widthMode: 'contained' } },
      footer: { layout: [], settings: { widthMode: 'full' } },
    },
  })
  expect(created.ok()).toBeTruthy()
  const { doc } = await created.json()
  await page.goto(`/admin/collections/site-templates/${doc.id}`)
  await expect(page.getByRole('heading', { name: 'Header', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Footer', exact: true })).toHaveCount(0)
  for (const region of ['Header', 'Footer']) {
    await page.getByRole('tab', { name: region, exact: true }).click()
    const shell = page.getByTestId(`site-shell-${region.toLowerCase()}`)
    await expect(shell.getByRole('tab', { name: 'List View', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await shell.getByRole('button', { name: 'Add block', exact: true }).click()
    await shell
      .locator('.builder-sidebar')
      .getByRole('button', { name: 'Text', exact: true })
      .click()
    await shell.getByRole('textbox', { name: 'Text', exact: true }).fill(`${region} actual text`)
    await shell.getByRole('button', { name: 'Save Element', exact: true }).click()
    await shell.getByRole('tab', { name: 'Outline' }).click()
    await expect(shell.locator('.builder-sidebar')).toContainText('3 words')
  }
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/site-templates/${doc.id}?draft=true`)
      return (await response.json()).footer.layout.length
    })
    .toBe(1)
  await page.reload()
  const saved = await (await page.request.get(`/api/site-templates/${doc.id}?draft=true`)).json()
  expect(saved.header.layout[0].props.text).toBe('Header actual text')
  expect(saved.footer.layout[0].props.text).toBe('Footer actual text')
  expect(saved.header.settings.widthMode).toBe('contained')
})

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
    await workspace.getByRole('button', { name: 'Add block', exact: true }).click()
    await library.getByRole('button', { name: 'Heading', exact: true }).click()
    await workspace.locator('textarea[aria-label="Heading"]').fill('A styled heading')
    await expect(workspace.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await workspace.locator('.content-workspace__right').getByText('Style', { exact: true }).click()
    await workspace
      .locator('summary')
      .filter({ hasText: /^Background$/ })
      .click()
    await workspace.getByRole('textbox', { name: 'Background color', exact: true }).fill('#ffeecc')
    await workspace.getByRole('textbox', { name: 'Background color', exact: true }).press('Tab')
    await workspace.getByRole('tab', { name: 'Layout', exact: true }).click()
    await workspace.getByRole('textbox', { name: 'Padding', exact: true }).fill('24px')
    await workspace.getByRole('textbox', { name: 'Padding', exact: true }).press('Tab')
    await expect(workspace.locator('[data-block-kind=heading]')).toHaveCSS(
      'background-color',
      'rgb(255, 238, 204)',
    )
    await workspace.getByRole('button', { name: 'Add block', exact: true }).click()
    await library.getByRole('button', { name: 'Columns', exact: true }).click()
    await workspace.locator('textarea[aria-label="Heading"]').click()
    const move = workspace.getByRole('combobox', { name: 'Move block into', exact: true })
    const firstColumn = await move
      .locator('option')
      .filter({ hasText: /^column$/i })
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
    await expect
      .poll(async () =>
        page
          .locator('[data-block-kind=columns]')
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      )
      .toBe(1)
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
  await workspace.getByRole('button', { name: 'Add block', exact: true }).click()
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
  await workspace.getByRole('tab', { name: 'Layout', exact: true }).click()
  await workspace.getByRole('textbox', { name: 'Padding', exact: true }).fill('8px')
  await workspace.getByRole('textbox', { name: 'Padding', exact: true }).press('Tab')
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

test('complete registered catalog survives API saving in every storage adapter', async ({
  page,
}) => {
  const suffix = `catalog-${Date.now()}`
  const { user } = await (await page.request.get('/api/users/me')).json()
  const nodes = listBlockDefinitions()
    .filter((definition) => definition.type !== 'column')
    .map((definition) => createContentNode(definition.type))
  for (const collection of ['posts', 'pages']) {
    const response = await page.request.post(`/api/${collection}`, {
      data: {
        title: suffix,
        slug: suffix,
        author: user.id,
        _status: 'draft',
        contentLayout: { version: 1, nodes },
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const saved = (await response.json()).doc
    const reloaded = await (
      await page.request.get(`/api/${collection}/${saved.id}?draft=true`)
    ).json()
    expect(reloaded.contentLayout.nodes).toEqual(nodes)
    const unsafe = await page.request.patch(`/api/${collection}/${saved.id}`, {
      data: {
        contentLayout: {
          version: 1,
          nodes: [{ ...nodes[0], presentation: { css: 'body { display:none }' } }],
        },
      },
    })
    expect(unsafe.ok()).toBeFalsy()
    const published = await page.request.patch(`/api/${collection}/${saved.id}`, { data: { _status: 'published' } })
    expect(published.ok(), await published.text()).toBeTruthy()
    const rendered = await page.request.get(collection === 'posts' ? `/posts/${suffix}` : `/${suffix}`)
    expect(rendered.ok()).toBeTruthy()
    const html = await rendered.text()
    for (const node of nodes) expect(html).toContain(`data-block-kind="${node.kind}"`)
  }
  const template = await page.request.post('/api/design-templates', {
    data: {
      name: suffix,
      slug: suffix,
      status: 'draft',
      _status: 'draft',
      allowedCollections: ['posts', 'pages'],
      sections: [],
      layout: nodes.map(toTemplateBlock),
    },
  })
  expect(template.ok(), await template.text()).toBeTruthy()
  expect((await template.json()).doc.layout).toEqual(nodes.map(toTemplateBlock))
  const shell = await page.request.post('/api/site-templates', {
    data: {
      name: suffix,
      slug: suffix,
      _status: 'draft',
      header: { layout: nodes.map(toShellBlock) },
      footer: { layout: nodes.map(toShellBlock) },
    },
  })
  expect(shell.ok(), await shell.text()).toBeTruthy()
  expect((await shell.json()).doc.footer.layout).toEqual(nodes.map(toShellBlock))
})

test('registered block inspector updates canvas, preserves its tab and saves advanced settings', async ({
  page,
}) => {
  const suffix = `inspector-${Date.now()}`
  await page.goto('/admin/collections/pages/create')
  const workspace = page.locator('.content-workspace')
  await workspace.getByRole('button', { name: 'Add block', exact: true }).click()
  await workspace
    .locator('.builder-sidebar')
    .getByRole('button', { name: 'Progress Bar', exact: true })
    .click()
  const inspector = workspace.locator('.unified-block-inspector')
  await inspector.getByRole('spinbutton', { name: /^Value/ }).fill('75')
  await expect(workspace.locator('progress')).toHaveAttribute('value', '75')
  await inspector.getByRole('tab', { name: 'Layout', exact: true }).click()
  await inspector.getByRole('textbox', { name: 'Padding', exact: true }).fill('18px')
  await inspector.getByRole('tab', { name: 'Advanced', exact: true }).click()
  await inspector.getByText('Custom CSS', { exact: true }).click()
  await inspector
    .getByRole('textbox', { name: 'Custom CSS', exact: true })
    .fill('& progress { accent-color: green; }')
  await inspector.getByRole('textbox', { name: 'Custom CSS', exact: true }).press('Tab')
  await page.screenshot({ path: '.wrangler/framework-inspector.png' })
  await workspace.getByRole('tab', { name: 'Document settings', exact: true }).click()
  await workspace.locator('input[name=title]').fill(suffix)
  await workspace.locator('input[name=slug]').fill(suffix)
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await page.waitForURL(/collections\/pages\/\d+/)
  const saved = await (
    await page.request.get(`/api/pages/${page.url().split('/').at(-1)}?draft=true`)
  ).json()
  expect(saved.contentLayout.nodes[0].props.value).toBe(75)
  expect(saved.contentLayout.nodes[0].presentation.css).toContain('accent-color')
  await page.reload()
  await expect(workspace.locator('progress')).toHaveAttribute('value', '75')
})
