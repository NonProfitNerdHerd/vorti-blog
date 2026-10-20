import { test, expect } from '@playwright/test'
import { listViews } from '../../packages/payload-design-core/src/views/model'

test('named Event and post displays are selectable in every editor and create working central views', async ({
  page,
}) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBeTruthy()
  const user = (await login.json()).user
  for (const collection of ['pages', 'posts', 'design-templates', 'site-templates']) {
    const name = `Display placement ${collection} ${Date.now()}`
    const response = await page.request.post(`/api/${collection}`, {
      data: {
        title: name,
        name,
        slug: `display-${collection}-${Date.now()}`,
        author: user.id,
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
    const doc = (await response.json()).doc
    await page.goto(`/admin/collections/${collection}/${doc.id}`)
    if (collection === 'site-templates')
      await page.getByRole('tab', { name: 'Header', exact: true }).click()
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    const library = page.locator('.builder-sidebar')
    for (const view of listViews())
      await expect(library.getByRole('button', { name: view.label, exact: true })).toHaveCount(1)
    if (collection === 'pages') {
      await library.getByRole('textbox', { name: 'Search blocks', exact: true }).fill('postx')
      await expect(library.getByRole('button', { name: 'Post Grid 7', exact: true })).toBeVisible()
      await page.screenshot({ path: '.wrangler/post-display-inserter.png' })
      await library.getByRole('textbox', { name: 'Search blocks', exact: true }).fill('events')
      await expect(
        library.getByRole('button', { name: 'Month Calendar', exact: true }),
      ).toBeVisible()
      await page.screenshot({ path: '.wrangler/event-display-inserter.png' })
      await library.getByRole('textbox', { name: 'Search blocks', exact: true }).fill('')
    }
    const label = collection === 'pages' ? 'Month Calendar' : 'Post Grid 7'
    await library.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('group', { name: `Set up ${label}`, exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'View name', exact: true }).fill(name)
    if (collection === 'pages') {
      const tag = await page.request.post('/api/tags', {
        data: { name, slug: `display-tag-${Date.now()}` },
      })
      expect(tag.ok()).toBeTruthy()
      await page.getByRole('textbox', { name: 'Search Tags', exact: true }).fill(name)
      await page.getByRole('checkbox', { name, exact: true }).check()
      await page.getByRole('combobox', { name: 'Tag matching', exact: true }).selectOption('all')
    }
    await page.getByRole('button', { name: 'Create view and use here', exact: true }).click()
    await expect(page.getByRole('group', { name: `Set up ${label}`, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save Element', exact: true })).toHaveCount(0)
    await expect(page.locator('.content-view').first()).toBeVisible()
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
    await expect
      .poll(async () =>
        JSON.stringify(
          await (await page.request.get(`/api/${collection}/${doc.id}?draft=true`)).json(),
        ),
      )
      .toContain('viewID')
    await page.reload()
    if (collection === 'site-templates')
      await page.getByRole('tab', { name: 'Header', exact: true }).click()
    await expect(page.locator('.content-view').first()).toBeVisible()
    if (collection === 'pages') {
      await page.getByRole('button', { name: /Publish changes/i }).click()
      await expect
        .poll(async () => (await (await page.request.get(`/api/pages/${doc.id}`)).json())._status)
        .toBe('published')
      await page.goto(`/${doc.slug}`)
      await expect(page.locator('.content-view')).toBeVisible()
    }
    if (collection === 'site-templates') {
      await page.getByRole('tab', { name: 'Footer', exact: true }).click()
      await page.getByRole('button', { name: 'Add block', exact: true }).click()
      await expect(
        library.getByRole('button', { name: 'Event Carousel', exact: true }),
      ).toBeVisible()
    }
  }
})

test('production Event editor exposes blocks, panels and a working Saved View chooser', async ({
  page,
}) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(login.ok()).toBeTruthy()
  const user = (await login.json()).user
  const suffix = Date.now()
  const response = await page.request.post('/api/posts', {
    data: {
      title: 'Restored Event editor',
      slug: `restored-event-${suffix}`,
      author: user.id,
      _status: 'draft',
      event: {
        schedule: {
          start: '2026-11-01T09:00',
          end: '2026-11-01T10:00',
          timezone: 'America/Chicago',
        },
      },
      contentLayout: { version: 1, nodes: [] },
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const doc = (await response.json()).doc
  const viewResponse = await page.request.post('/api/saved-views', {
    data: {
      name: `Restored view ${suffix}`,
      _status: 'published',
      configuration: { version: 1, layout: 'grid-1', query: { source: 'posts', limit: 3 } },
    },
  })
  expect(viewResponse.ok(), await viewResponse.text()).toBeTruthy()
  const view = (await viewResponse.json()).doc
  await page.goto(`/admin/collections/posts/${doc.id}`)
  const workspace = page.locator('.content-workspace')
  await expect(workspace).toBeVisible()
  await expect(page.locator('.doc-header input[name=title]')).toHaveValue('Restored Event editor')
  await expect(workspace.locator('.content-workspace__left')).toBeVisible()
  await expect(workspace.locator('.content-workspace__right')).toBeVisible()
  await expect(workspace.getByRole('tab', { name: 'Document settings', exact: true })).toHaveText(
    'Post',
  )
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await workspace
    .locator('.content-workspace__left')
    .getByRole('button', { name: 'Saved View', exact: true })
    .click()
  const inspector = workspace.locator('.content-workspace__right')
  await inspector.getByRole('textbox', { name: 'Search Saved View', exact: true }).fill(view.name)
  await inspector.getByRole('checkbox', { name: view.name, exact: true }).check()
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect
    .poll(async () => {
      const saved = await (await page.request.get(`/api/posts/${doc.id}?draft=true`)).json()
      return saved.contentLayout.nodes[0]?.props?.viewID
    })
    .toBe(String(view.id))
  await page.reload()
  await expect(workspace.locator('[data-block-kind=savedView]')).toBeVisible()
  await page.getByRole('button', { name: /Publish changes/i }).click()
  await expect
    .poll(async () => (await (await page.request.get(`/api/posts/${doc.id}`)).json())._status)
    .toBe('published')
  await page.goto(`/posts/${doc.slug}`)
  await expect(page.locator('.content-view')).toBeVisible()
})

test('Site Design ordering and shared Hero insertion survive Template save and reload', async ({
  page,
}) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBeTruthy()
  const response = await page.request.post('/api/design-templates', {
    data: {
      name: 'Unified template ' + Date.now(),
      slug: 'unified-' + Date.now(),
      status: 'draft',
      _status: 'draft',
      allowedCollections: ['pages'],
      layout: [],
      sections: [],
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const doc = (await response.json()).doc
  await page.goto('/admin/collections/design-templates/' + doc.id)
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  const library = page.locator('.builder-sidebar')
  await expect(library.getByRole('button', { name: 'Hero', exact: true })).toHaveCount(1)
  await library.getByRole('button', { name: 'Hero', exact: true }).click()
  const canvas = page.getByRole('main', { name: 'Template Canvas' })
  await expect(canvas.getByText('Select a variation to start with')).toBeVisible()
  await expect(canvas.getByRole('button', { name: 'Horizontal', exact: true })).toBeVisible()
  await canvas.getByRole('button', { name: 'Horizontal', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save Element', exact: true })).toHaveCount(0)
  const text = canvas.locator('textarea').first()
  await text.fill('Template inline headline')
  await library.getByRole('button', { name: 'Hero', exact: true }).click()
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('button', { name: 'Center Overlay', exact: true }).click()
  await expect(text).toHaveValue('Template inline headline')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(text).toHaveValue('Template inline headline')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(text).toHaveValue('Template inline headline')
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect
    .poll(async () =>
      JSON.stringify(
        await (await page.request.get('/api/design-templates/' + doc.id + '?draft=true')).json(),
      ),
    )
    .toContain('Template inline headline')
  await page.reload()
  await expect(canvas.locator('textarea').first()).toHaveValue('Template inline headline')
  const navToggle = page.locator('.nav-toggler').first()
  if (await navToggle.isVisible()) await navToggle.click()
  const group = page
    .locator('.nav-group')
    .filter({ has: page.locator('.nav-group__label', { hasText: 'Site Design' }) })
  if (!(await group.locator('a').first().isVisible())) await group.locator('button').first().click()
  await expect(group.locator('.nav__link-label')).toHaveText([
    'Site Templates',
    'Menus',
    'Site Settings',
    'Block Creator',
    'Page/Post Templates',
    'Post Types',
  ])
  const forms = page.locator('.nav-group').filter({ has: page.locator('.nav-group__label', { hasText: /^Forms$/ }) })
  if (!(await forms.locator('a').first().isVisible())) await forms.locator('button').first().click()
  await expect(forms.locator('.nav__link-label')).toHaveText(['Forms', 'Form Submissions'])
})

test('Designed Blocks choose published designs visually and preserve field mappings', async ({
  page,
}) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBeTruthy()
  const suffix = Date.now()
  const typeResponse = await page.request.post('/api/design-block-types', {
    data: {
      name: 'Review Hero Board ' + suffix,
      slug: 'review-hero-' + suffix,
      rendererKey: 'hero-board',
      status: 'published',
      _status: 'published',
      fields: [{ key: 'headline', label: 'Headline', kind: 'text' }],
    },
  })
  expect(typeResponse.ok(), await typeResponse.text()).toBeTruthy()
  const type = (await typeResponse.json()).doc
  const designs = []
  for (const name of ['Classic', 'Split']) {
    const response = await page.request.post('/api/design-block-designs', {
      data: {
        name,
        slug: name.toLowerCase() + '-' + suffix,
        blockType: type.id,
        status: 'published',
        _status: 'published',
        design: { imageTreatment: name === 'Split' ? 'split' : 'background' },
      },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    designs.push((await response.json()).doc)
  }
  const response = await page.request.post('/api/design-templates', {
    data: {
      name: 'Designed preview ' + suffix,
      slug: 'designed-' + suffix,
      status: 'draft',
      _status: 'draft',
      allowedCollections: ['pages'],
      layout: [],
      sections: [],
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const doc = (await response.json()).doc
  await page.goto('/admin/collections/design-templates/' + doc.id)
  await page.getByRole('button', { name: 'Add block', exact: true }).click()
  await page
    .locator('.builder-sidebar')
    .getByRole('button', { name: type.name, exact: true })
    .click()
  const picker = page.getByRole('group', { name: 'Select a design to start with', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'Split', exact: true }).click()
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await page.request.get('/api/design-templates/' + doc.id + '?draft=true')).json())
          .layout[0]?.blockDesign,
    )
    .toBe(designs[1].id)
  const saved = await (
    await page.request.get('/api/design-templates/' + doc.id + '?draft=true&depth=0')
  ).json()
  const node = saved.layout[0]
  node.fields = [
    {
      id: 'review-heading',
      type: 'field',
      fieldType: 'shortText',
      label: 'Review headline',
      content: { source: 'static', value: 'Preserved headline' },
    },
  ]
  node.slotMappings = { headline: 'review-heading' }
  node.allowDesignOverride = true
  expect(
    (
      await page.request.patch('/api/design-templates/' + doc.id, {
        data: { layout: [node], _status: 'draft' },
      })
    ).ok(),
  ).toBeTruthy()
  await page.reload()
  await page
    .locator('.builder-sidebar')
    .getByRole('button', { name: type.name, exact: true })
    .click()
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page
    .getByRole('group', { name: 'Layout designs', exact: true })
    .getByRole('button', { name: 'Classic', exact: true })
    .click()
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get('/api/design-templates/' + doc.id + '?draft=true&depth=0')
          ).json()
        ).layout[0]?.blockDesign,
    )
    .toBe(designs[0].id)
  const updated = await (
    await page.request.get('/api/design-templates/' + doc.id + '?draft=true&depth=0')
  ).json()
  expect(updated.layout[0].id).toBe(node.id)
  expect(updated.layout[0].fields).toEqual(node.fields)
  expect(updated.layout[0].slotMappings).toEqual(node.slotMappings)
  expect(updated.layout[0].allowDesignOverride).toBe(true)
})

test('Template and Site Template rich text edits survive saving', async ({ page }) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: { email: 'dev@payloadcms.com', password: 'test' },
      })
    ).ok(),
  ).toBeTruthy()
  for (const collection of ['design-templates', 'site-templates']) {
    const suffix = Date.now()
    const data: Record<string, unknown> =
      collection === 'design-templates'
        ? {
            name: 'Rich Template ' + suffix,
            slug: 'rich-template-' + suffix,
            status: 'draft',
            _status: 'draft',
            allowedCollections: ['pages'],
            layout: [],
            sections: [],
          }
        : {
            name: 'Rich shell ' + suffix,
            slug: 'rich-shell-' + suffix,
            _status: 'draft',
            header: { layout: [] },
            footer: { layout: [] },
          }
    const response = await page.request.post('/api/' + collection, { data })
    expect(response.ok(), await response.text()).toBeTruthy()
    const doc = (await response.json()).doc
    await page.goto('/admin/collections/' + collection + '/' + doc.id)
    if (collection === 'site-templates')
      await page.getByRole('tab', { name: 'Header', exact: true }).click()
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await page
      .locator('.builder-sidebar')
      .getByRole('button', { name: 'Rich Text', exact: true })
      .click()
    const editable = page.locator('[contenteditable=true]').first()
    await expect(editable).toBeVisible()
    await editable.fill('Template formatted content')
    await editable.press('Control+a')
    await editable.press('Control+b')
    await expect(editable.locator('strong')).toContainText('Template formatted content')
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
    await expect
      .poll(async () =>
        JSON.stringify(
          await (
            await page.request.get('/api/' + collection + '/' + doc.id + '?draft=true')
          ).json(),
        ),
      )
      .toContain('Template formatted content')
    await page.reload()
    if (collection === 'site-templates')
      await page.getByRole('tab', { name: 'Header', exact: true }).click()
    await expect(page.locator('[contenteditable=true] strong').first()).toContainText(
      'Template formatted content',
    )
  }
})

test('Templates use native actions, document tabs, and shared inspector controls', async ({ page }) => {
  expect((await page.request.post('/api/users/login', { data: { email: 'dev@payloadcms.com', password: 'test' } })).ok()).toBeTruthy()
  for (const collection of ['design-templates', 'site-templates']) {
    await page.goto(`/admin/collections/${collection}/create`)
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`Native header ${collection} ${Date.now()}`)
    if (collection === 'design-templates') {
      await page.getByRole('tab', { name: 'Document settings', exact: true }).click()
      await page.getByLabel('Pages', { exact: true }).check()
    }
    const save = page.getByRole('button', { name: 'Save Draft', exact: true })
    const publish = page.getByRole('button', { name: /Publish changes/i })
    await expect(save).toHaveCount(1)
    await expect(publish).toHaveCount(1)
    await expect(save).toHaveClass(/btn/)
    await expect(publish).toHaveClass(/btn--style-primary/)
    await save.click()
    await expect(page).toHaveURL(new RegExp(`/admin/collections/${collection}/[0-9]+$`))
    await expect(page.getByRole('link', { name: /^Versions/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'API', exact: true })).toBeVisible()
    await publish.click()
    const id = page.url().split('/').at(-1)
    await expect.poll(async () => (await (await page.request.get(`/api/${collection}/${id}`)).json())._status).toBe('published')
    await expect(save).toBeDisabled()
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`Draft update ${collection}`)
    await save.click()
    await expect.poll(async () => (await (await page.request.get(`/api/${collection}/${id}?draft=true`)).json()).name).toBe(`Draft update ${collection}`)
    expect((await (await page.request.get(`/api/${collection}/${id}?draft=false`)).json()).name).not.toBe(`Draft update ${collection}`)
    if (collection === 'site-templates') await page.getByRole('tab', { name: 'Header', exact: true }).click()
    await page.screenshot({ path: `.wrangler/native-header-${collection}.png` })
    await page.getByRole('tab', { name: 'Document settings', exact: true }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('tab', { name: 'Block', exact: true })).toBeFocused()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500) // Payload's responsive navigation transition.
    const closeNav = page.getByRole('button', { name: 'Close', exact: true })
    const navBounds = await closeNav.isVisible() ? await closeNav.boundingBox() : null
    if (navBounds && navBounds.x >= 0 && navBounds.x < 390 && await closeNav.getAttribute('tabindex') !== '-1') await closeNav.click()
    await page.screenshot({ path: `.wrangler/native-header-mobile-before-${collection}.png` })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.screenshot({ path: `.wrangler/native-header-mobile-${collection}.png` })
    await page.setViewportSize({ width: 1800, height: 1100 })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  }
})
