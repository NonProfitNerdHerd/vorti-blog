import { createContentNode } from '../../packages/payload-design-core/src/content/model'
import { listBlockDefinitions } from '../../packages/payload-design-core/src/blocks/registry'
import {
  toTemplateBlock,
  toShellBlock,
} from '../../packages/payload-design-core/src/blocks/adapters'
import { expect, test } from '@playwright/test'

test('expanded inspector preserves settings and restores the sidebar across editor contexts', async ({
  page,
}) => {
  test.setTimeout(240000)
  const { user } = await (await page.request.get('/api/users/me')).json()
  for (const collection of ['pages', 'posts', 'design-templates', 'site-templates']) {
    const name = `expanded-${collection}-${Date.now()}`
    const response = await page.request.post(`/api/${collection}`, {
      data: {
        [collection === 'pages' || collection === 'posts' ? 'title' : 'name']: name,
        slug: name,
        _status: 'draft',
        ...(collection === 'posts' ? { author: user.id } : {}),
        ...(collection === 'pages' || collection === 'posts'
          ? {
              contentLayout: {
                version: 1,
                nodes: [
                  {
                    id: 'dialog-heading',
                    kind: 'heading',
                    label: 'Heading',
                    text: 'Keep this draft',
                  },
                ],
              },
            }
          : {}),
        ...(collection === 'design-templates' ? { layout: [], allowedCollections: ['pages'] } : {}),
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const { doc } = await response.json()
    await page.goto(`/admin/collections/${collection}/${doc.id}`)
    if (collection === 'site-templates')
      await page.getByRole('tab', { name: 'Header', exact: true }).click()
    await page.getByRole('tab', { name: 'Document settings', exact: true }).click()
    await page.getByRole('button', { name: 'Expand inspector' }).click()
    const dialog = page.locator('.editor-dialog-layer')
    await expect(dialog).toBeVisible()
    await expect(page.locator('.builder-frame')).toHaveAttribute('data-right', 'false')
    const bounds = await dialog.locator('.editor-dialog-card').boundingBox()
    expect(bounds!.width).toBeCloseTo(720, 0)
    expect(bounds!.x + bounds!.width / 2).toBeCloseTo(900, 0)
    if (collection === 'pages')
      await page.screenshot({ path: '.wrangler/expanded-inspector-desktop.png' })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.builder-frame')).toHaveAttribute('data-right', 'true')
    await expect(page.getByRole('button', { name: 'Expand inspector' })).toBeFocused()
    if (collection === 'pages' || collection === 'posts') {
      await page.locator('textarea[aria-label="Heading"]').fill('Keep this unsaved edit')
      await page.getByRole('button', { name: 'Expand inspector' }).click()
      await dialog.getByRole('tab', { name: 'Layout', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'Padding', exact: true }).fill('19px')
      await dialog.getByRole('textbox', { name: 'Padding', exact: true }).press('Tab')
      await dialog.getByRole('button', { name: 'Close dialog' }).click()
      await expect(page.locator('textarea[aria-label="Heading"]')).toHaveValue(
        'Keep this unsaved edit',
      )
      await expect(page.locator('[data-block-kind=heading]')).toHaveCSS('padding-top', '19px')
      await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
      await expect
        .poll(async () => {
          const saved = await (
            await page.request.get(`/api/${collection}/${doc.id}?draft=true`)
          ).json()
          return saved.contentLayout?.nodes[0]?.text
        })
        .toBe('Keep this unsaved edit')
      await page.reload()
      await expect(page.locator('textarea[aria-label="Heading"]')).toHaveValue(
        'Keep this unsaved edit',
      )
      await expect(page.locator('[data-block-kind=heading]')).toHaveCSS('padding-top', '19px')
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const inspectorToggle = page.getByRole('button', { name: 'Toggle inspector', exact: true })
  if ((await inspectorToggle.getAttribute('aria-expanded')) !== 'true')
    await inspectorToggle.click()
  await page.getByRole('button', { name: 'Expand inspector' }).click()
  await expect(page.locator('.editor-dialog-card')).toBeVisible()
  expect(
    await page.locator('.editor-dialog-card').evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.wrangler/expanded-inspector-mobile.png' })
})

test('Hero variation chooser preserves editable content through layout changes and reload', async ({
  page,
}) => {
  const response = await page.request.post('/api/pages', {
    data: {
      title: 'Hero layout review',
      slug: `hero-review-${Date.now()}`,
      contentLayout: { version: 1, nodes: [] },
      _status: 'draft',
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const { doc } = await response.json()
  await page.goto(`/admin/collections/pages/${doc.id}`)
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await page
    .locator('.content-workspace__left')
    .getByRole('button', { name: 'Hero', exact: true })
    .click()
  const canvas = page.locator('.content-workspace__center')
  await expect(canvas.getByText('Select a variation to start with')).toBeVisible()
  await canvas.getByRole('button', { name: 'Horizontal', exact: true }).click()
  await expect(canvas.locator('[data-block-kind="hero"]')).toHaveAttribute(
    'data-variation',
    'horizontal',
  )
  await canvas.locator('textarea[aria-label="Heading"]').fill('Preserved hero headline')
  await page
    .locator('.content-workspace__left')
    .getByRole('button', { name: 'Hero', exact: true })
    .click()
  const inspector = page.locator('.content-workspace__right')
  await inspector.getByRole('tab', { name: 'Layout', exact: true }).click()
  await inspector.getByRole('button', { name: 'Center Overlay', exact: true }).click()
  await expect(canvas.locator('textarea[aria-label="Heading"]')).toHaveValue(
    'Preserved hero headline',
  )
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(canvas.locator('[data-block-kind="hero"]')).toHaveAttribute(
    'data-variation',
    'horizontal',
  )
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(canvas.locator('[data-block-kind="hero"]')).toHaveAttribute(
    'data-variation',
    'center-overlay',
  )
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect
    .poll(async () => {
      const result = await page.request.get(`/api/pages/${doc.id}?draft=true`)
      return (await result.json()).contentLayout.nodes[0]?.variation?.id
    })
    .toBe('center-overlay')
  await page.reload()
  await expect(page.locator('.builder-frame')).toHaveAttribute('data-integrated', 'true')
  await expect(canvas.locator('[data-block-kind="hero"]')).toHaveAttribute(
    'data-variation',
    'center-overlay',
  )
  await expect(canvas.getByText('Select a variation to start with')).toHaveCount(0)
  await expect(canvas.locator('textarea[aria-label="Heading"]')).toHaveValue(
    'Preserved hero headline',
  )
  await page.screenshot({ path: '.wrangler/hero-variation-desktop.png' })
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await page.screenshot({ path: '.wrangler/hero-variation-phone.png' })
})

test('full-height panels and contextual actions keep the canvas clear', async ({ page }) => {
  const nodes = Array.from({ length: 35 }, (_, index) => ({
    ...createContentNode('paragraph'),
    label: `Paragraph ${index + 1}`,
    text: `Body ${index + 1}`,
  }))
  const response = await page.request.post('/api/pages', {
    data: {
      title: 'Panel geometry',
      slug: `panels-${Date.now()}`,
      contentLayout: { version: 1, nodes },
      _status: 'draft',
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const { doc } = await response.json()
  await page.goto(`/admin/collections/pages/${doc.id}`)
  const frame = page.locator('.builder-frame')
  const left = page.locator('.content-workspace__left')
  await expect(frame).toHaveAttribute('data-integrated', 'true')
  const status = (await page.locator('.doc-controls').boundingBox())!
  const bounds = (await frame.boundingBox())!
  expect(Math.abs(bounds.y - status.y - status.height)).toBeLessThan(2)
  expect(Math.abs(bounds.y + bounds.height - 1100)).toBeLessThan(2)
  expect((await left.boundingBox())!.height).toBe(bounds.height)
  expect((await left.locator('.builder-sidebar__row').first().boundingBox())!.height).toBe(28)
  await expect(
    page.locator('.content-workspace__node-controls,.template-editor__toolbar'),
  ).toHaveCount(0)
  await left.getByRole('button', { name: 'Paragraph 2', exact: true }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Paragraph 2 block controls' })
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole('button', { name: 'Actions for Paragraph 2' }).click()
  const popup = page.getByRole('dialog', { name: 'Paragraph 2 actions' })
  await expect(popup).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(toolbar.getByRole('button', { name: 'Actions for Paragraph 2' })).toBeFocused()
  await toolbar.getByRole('button', { name: 'Actions for Paragraph 2' }).click()
  await popup.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(left.locator('.builder-sidebar__row')).toHaveCount(36)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(left.locator('.builder-sidebar__row')).toHaveCount(35)
  await left.getByRole('button', { name: 'Paragraph 2', exact: true }).click()
  await page.getByRole('button', { name: 'List View', exact: true }).click()
  await expect(left).toBeHidden()
  await expect(page.locator('.block-actions__toolbar')).toBeVisible()
  await page.getByRole('button', { name: 'List View', exact: true }).click()
  const canvas = page.locator('.content-workspace__center')
  await canvas.evaluate((element) => {
    element.scrollTop = 300
  })
  expect(await left.evaluate((element) => element.scrollTop)).toBe(0)
  await page.screenshot({ path: '.wrangler/panels-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'List View', exact: true }).click()
  await expect(left).toBeVisible()
  await left.getByRole('button', { name: 'Close left panel' }).focus()
  await page.keyboard.press('Escape')
  await expect(left).toBeHidden()
  await expect(page.getByRole('button', { name: 'List View', exact: true })).toBeFocused()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: '.wrangler/panels-mobile-dark.png' })
})

test('document header owns the inline title and controls across editor contexts', async ({
  page,
}) => {
  for (const collection of ['pages', 'design-templates', 'site-templates']) {
    const name = `header-${collection}-${Date.now()}`
    const titleField = collection === 'pages' ? 'title' : 'name'
    const response = await page.request.post(`/api/${collection}`, {
      data: {
        [titleField]: name,
        slug: name,
        _status: 'draft',
        ...(collection === 'design-templates'
          ? { status: 'draft', allowedCollections: ['pages'], layout: [], sections: [] }
          : {}),
        ...(collection === 'site-templates'
          ? { header: { layout: [] }, footer: { layout: [] } }
          : {}),
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    const { doc } = await response.json()
    await page.goto(`/admin/collections/${collection}/${doc.id}`)
    const title = page.locator(`.doc-header input[name="${titleField}"]`)
    await expect(title).toHaveValue(name)
    await expect(page.locator(`input[name="${titleField}"]:not([type="hidden"])`)).toHaveCount(1)
    await title.fill(`${name} updated`)
    if (collection === 'site-templates')
      await page.getByRole('tab', { name: 'Header', exact: true }).click()
    const controls = page.locator('.doc-controls')
    await expect(controls.getByRole('button', { name: 'Add block', exact: true })).toBeVisible()
    await expect(
      page.locator('.doc-tabs').getByRole('button', { name: 'Undo', exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0)
    await controls.getByRole('button', { name: 'Tablet', exact: true }).click()
    await expect(controls.getByRole('button', { name: 'Tablet', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await controls.getByRole('button', { name: 'Toggle inspector' }).click()
    await expect(controls.getByRole('button', { name: 'Toggle inspector' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await controls.getByRole('button', { name: 'Toggle inspector' }).click()
    await controls.getByRole('button', { name: 'Save Draft', exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/${collection}/${doc.id}?draft=true`, { maxRetries: 2 })
            ).json()
          )[titleField],
      )
      .toBe(`${name} updated`)
    await page.reload()
    await expect(title).toHaveValue(`${name} updated`)
    if (collection === 'pages') {
      await page.setViewportSize({ width: 390, height: 844 })
      // Payload persists navigation state per user. Its mobile navigation pushes
      // the document offscreen; dismiss it before measuring the editor itself.
      await page.waitForTimeout(500) // Allow Payload's responsive navigation transition to finish.
      const navigation = page.getByRole('button', { name: 'Close', exact: true })
      const navBounds = await navigation.boundingBox()
      if (navBounds && navBounds.x >= 0 && navBounds.x < 390) await navigation.click()
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true)
      await expect.poll(async () => (await controls.boundingBox())!.height).toBeLessThan(230)
      await page.screenshot({ path: '.wrangler/header-mobile.png' })
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await page.screenshot({ path: '.wrangler/header-mobile-dark.png' })
      await page.setViewportSize({ width: 1800, height: 1100 })
    }
  }
})

test('compact inspector synchronizes devices, resets individual spacing and restores focus', async ({
  page,
}) => {
  await page.goto('/admin/collections/pages/create')
  const workspace = page.locator('.content-workspace')
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await workspace
    .locator('.builder-sidebar')
    .getByRole('button', { name: 'Paragraph', exact: true })
    .click()
  const inspector = workspace.locator('.unified-block-inspector')
  await expect(inspector.locator('header strong')).toHaveCount(1)
  await expect(workspace.getByText('Move block into', { exact: true })).toHaveCount(0)
  await expect(workspace.getByRole('tab', { name: 'Document settings' })).toHaveText('Page')
  await inspector.getByRole('tab', { name: 'Layout', exact: true }).click()
  await inspector.getByRole('textbox', { name: 'Padding', exact: true }).fill('24px')
  await inspector.getByRole('button', { name: 'Padding device', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Tablet', exact: true }).click()
  await expect(workspace.locator('.content-workspace__viewport')).toHaveAttribute(
    'data-viewport',
    'tablet',
  )
  await page.keyboard.press('Escape')
  await expect(workspace.locator('.content-workspace__right')).toBeVisible()
  await inspector.getByRole('button', { name: 'Unlink Padding sides', exact: true }).click()
  await inspector.getByRole('textbox', { name: 'Padding top', exact: true }).fill('40px')
  const block = workspace.locator('.content-workspace__viewport [data-block-kind=paragraph]')
  await expect(block).toHaveCSS('padding-top', '40px')
  await expect(block).toHaveCSS('padding-right', '24px')
  await inspector.getByRole('button', { name: 'Reset Padding top', exact: true }).click()
  await expect(block).toHaveCSS('padding-top', '24px')
  await page.screenshot({ path: '.wrangler/compact-layout-desktop.png' })
  await inspector.getByRole('tab', { name: 'Style', exact: true }).click()
  await inspector.getByText('Background', { exact: true }).click()
  await inspector.getByRole('button', { name: 'Background color', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Background color value' })
    .fill('#abcdef')
  await expect(block).toHaveCSS('background-color', 'rgb(171, 205, 239)')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: '.wrangler/compact-inspector-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Toggle inspector' }).click()
  await page.screenshot({ path: '.wrangler/compact-inspector-mobile.png' })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: '.wrangler/compact-inspector-mobile-dark.png' })
  await page.keyboard.press('Escape')
  await expect(workspace.locator('.content-workspace__right')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Toggle inspector' })).toBeFocused()
})

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
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await sidebar.getByRole('textbox', { name: 'Search blocks' }).fill('heading')
  await sidebar.getByRole('button', { name: 'Heading', exact: true }).click()
  await workspace.locator('textarea[aria-label=Heading]').fill('A useful heading')
  await sidebar.getByRole('tab', { name: 'Outline' }).click()
  await expect(sidebar).toContainText('3 words')
  await sidebar.getByRole('button', { name: 'H2 A useful heading' }).click()
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await sidebar.getByRole('textbox', { name: 'Search blocks' }).fill('paragraph')
  await sidebar.getByRole('button', { name: 'Paragraph', exact: true }).click()
  await workspace.locator('textarea[aria-label=Paragraph]').fill('Some paragraph text')
  const drag = await sidebar.getByRole('button', { name: 'Paragraph', exact: true }).boundingBox()
  const drop = await sidebar.locator('[aria-label="Insert before Heading"]').boundingBox()
  expect(drag && drop).toBeTruthy()
  await page.mouse.move(drag!.x + drag!.width / 2, drag!.y + drag!.height / 2)
  await page.mouse.down()
  // Activate the row drag before measuring the live target; selection can scroll the panel.
  await page.mouse.move(drag!.x + drag!.width / 2 + 8, drag!.y + drag!.height / 2, { steps: 2 })
  const activeDrop = await sidebar.locator('[aria-label="Insert before Heading"]').boundingBox()
  await page.mouse.move(
    activeDrop!.x + activeDrop!.width / 2,
    activeDrop!.y + activeDrop!.height / 2,
    { steps: 12 },
  )
  await expect(sidebar.locator('[aria-label="Insert before Heading"]')).toHaveAttribute(
    'data-over',
    'true',
  )
  await page.mouse.up()
  // dnd-kit retains its document click suppressor for 50ms after a drop.
  // Allow that intentional cleanup before beginning the next user gesture.
  await page.waitForTimeout(100)
  await expect(
    workspace.locator('.content-workspace__viewport [data-block-kind]').first(),
  ).toHaveAttribute('data-block-kind', 'paragraph')
  await sidebar.getByRole('button', { name: 'Actions for Paragraph' }).click()
  await page
    .getByRole('dialog', { name: 'Paragraph actions' })
    .getByRole('button', { name: 'Duplicate', exact: true })
    .click()
  await expect(workspace.locator('textarea[aria-label=Paragraph]')).toHaveCount(2)
  await page.screenshot({ path: '.wrangler/sidebar-list-view.png' })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(workspace.locator('textarea[aria-label=Paragraph]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(workspace.locator('textarea[aria-label=Paragraph]')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  const opener = page.getByRole('button', { name: 'List View', exact: true })
  await opener.click()
  await sidebar.getByRole('tab', { name: 'Outline' }).press('Escape')
  await expect(sidebar).toBeHidden()
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
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await shell
      .locator('.builder-sidebar')
      .getByRole('button', { name: 'Paragraph', exact: true })
      .click()
    await shell.getByRole('textbox', { name: 'Text', exact: true }).fill(`${region} actual text`)
    await expect(shell.getByRole('button', { name: 'Save Element', exact: true })).toHaveCount(0)
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
  expect(saved.header.layout[0].block.text).toBe('Header actual text')
  expect(saved.footer.layout[0].block.text).toBe('Footer actual text')
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
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await library.getByRole('button', { name: 'Heading', exact: true }).click()
    await workspace.locator('textarea[aria-label="Heading"]').fill('A styled heading')
    await expect(workspace.getByRole('button', { name: 'Format text', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0)
    await workspace.locator('.content-workspace__right').getByText('Style', { exact: true }).click()
    await workspace
      .locator('summary')
      .filter({ hasText: /^Background$/ })
      .click()
    await workspace.getByRole('button', { name: 'Background color', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: 'Background color value', exact: true })
      .fill('#ffeecc')
    await page.keyboard.press('Escape')
    await workspace.getByRole('tab', { name: 'Layout', exact: true }).click()
    await workspace.getByRole('textbox', { name: 'Padding', exact: true }).fill('24px')
    await workspace.getByRole('textbox', { name: 'Padding', exact: true }).press('Tab')
    await expect(workspace.locator('[data-block-kind=heading]')).toHaveCSS(
      'background-color',
      'rgb(255, 238, 204)',
    )
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await library.getByRole('button', { name: 'Columns', exact: true }).click()
    await workspace.locator('textarea[aria-label="Heading"]').click()
    await library.getByRole('button', { name: 'Actions for Heading' }).click()
    const move = page
      .getByRole('dialog', { name: 'Heading actions' })
      .getByRole('combobox', { name: 'Move Heading into', exact: true })
    const firstColumn = await move
      .locator('option')
      .filter({ hasText: /^column$/i })
      .first()
      .getAttribute('value')
    await move.selectOption(firstColumn!)
    await expect(
      workspace.locator('[data-block-kind=columns] [data-block-kind=heading]'),
    ).toHaveCount(1)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(
      workspace.locator('[data-block-kind=columns] [data-block-kind=heading]'),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await workspace.getByRole('tab', { name: 'Document settings', exact: true }).click()
    await page.locator('input[name=title]').fill(`Editor ${suffix}`)
    await workspace.locator('input[name=slug]').fill(suffix)
    if (collection === 'posts') {
      await workspace.locator('#field-author input[role=combobox]').fill('dev@payloadcms.com')
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
  await expect(page.getByRole('button', { name: 'Toggle inspector', exact: true })).toBeVisible()
})

test('rich text formatting and responsive styles survive save and appear in draft preview', async ({
  page,
}) => {
  const suffix = `rich-${Date.now()}`
  await page.goto('/admin/collections/pages/create')
  const workspace = page.locator('.content-workspace')
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await workspace
    .locator('.content-workspace__left')
    .getByRole('button', { name: 'Rich text', exact: true })
    .click()
  const editable = workspace.locator('[contenteditable=true]').first()
  await editable.fill('Rich text preview')
  await expect(editable).toContainText('Rich text preview')
  await editable.click()
  await editable.press('Control+a')
  await editable.press('Control+b')
  await expect(editable.locator('strong')).toContainText('Rich text preview')
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await workspace.getByRole('tab', { name: 'Layout', exact: true }).click()
  await workspace.getByRole('textbox', { name: 'Padding', exact: true }).fill('8px')
  await workspace.getByRole('textbox', { name: 'Padding', exact: true }).press('Tab')
  await expect(workspace.locator('[data-block-kind=richText]')).toHaveCSS('padding-top', '8px')
  await workspace.getByRole('tab', { name: 'Document settings', exact: true }).click()
  await page.locator('input[name=title]').fill(suffix)
  await workspace.locator('input[name=slug]').fill(suffix)
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await page.waitForURL(/collections\/pages\/\d+/)
  const id = page.url().split('/').at(-1)
  const saved = await (await page.request.get(`/api/pages/${id}?draft=true`)).json()
  expect(saved.contentLayout.nodes[0].richText.root.children[0].children[0].format).not.toBe(0)
  await page.reload()
  await expect(workspace.locator('[contenteditable=true]').first().locator('strong')).toContainText(
    'Rich text preview',
  )
  const resolved = await page.request.post('/api/content-design-preview', { data: saved })
  expect(resolved.ok()).toBeTruthy()
  expect((await resolved.json())[0].node.styles.mobile.padding).toBe('8px')
  await page.goto(`/${suffix}?livePreview=${id}`)
  await expect(page.getByText('Rich text preview', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-block-kind=richText]')).toHaveCSS('padding-top', '8px')
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
    const published = await page.request.patch(`/api/${collection}/${saved.id}`, {
      data: { _status: 'published' },
    })
    expect(published.ok(), await published.text()).toBeTruthy()
    const rendered = await page.request.get(
      collection === 'posts' ? `/posts/${suffix}` : `/${suffix}`,
    )
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
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await workspace
    .locator('.builder-sidebar')
    .getByRole('button', { name: 'Progress Bar', exact: true })
    .click()
  const inspector = workspace.locator('.unified-block-inspector')
  await inspector.getByRole('spinbutton', { name: /^Value/ }).fill('75')
  await expect(workspace.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
  await inspector.getByRole('tab', { name: 'Layout', exact: true }).click()
  await inspector.getByRole('textbox', { name: 'Padding', exact: true }).fill('18px')
  await inspector.getByRole('tab', { name: 'Advanced', exact: true }).click()
  await inspector.getByText('Custom CSS', { exact: true }).click()
  await inspector
    .getByRole('textbox', { name: 'Custom CSS', exact: true })
    .fill('& .progress-fill { background-color: green; }')
  await inspector.getByRole('textbox', { name: 'Custom CSS', exact: true }).press('Tab')
  await page.screenshot({ path: '.wrangler/framework-inspector.png' })
  await workspace.getByRole('tab', { name: 'Document settings', exact: true }).click()
  await page.locator('input[name=title]').fill(suffix)
  await workspace.locator('input[name=slug]').fill(suffix)
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await page.waitForURL(/collections\/pages\/\d+/)
  const saved = await (
    await page.request.get(`/api/pages/${page.url().split('/').at(-1)}?draft=true`)
  ).json()
  expect(saved.contentLayout.nodes[0].props.value).toBe(75)
  expect(saved.contentLayout.nodes[0].presentation.css).toContain('background-color')
  await page.reload()
  await expect(workspace.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
})
