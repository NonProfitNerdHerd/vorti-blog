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
    if (collection === 'design-templates' || collection === 'site-templates')
      await page.getByRole('button', { name: 'Save Element', exact: true }).click()
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
  const typeResponse = await page.request.post('/api/post-types', {
    data: {
      key: `editor-event-${suffix}`,
      singular: 'Event',
      plural: 'Events',
      prefix: `editor-events-${suffix}`,
      capability: 'event',
      _status: 'published',
      fieldDefinitions: [
        { id: 'schedule', label: 'Schedule', kind: 'eventSchedule', public: true, required: true },
      ],
    },
  })
  expect(typeResponse.ok(), await typeResponse.text()).toBeTruthy()
  const type = (await typeResponse.json()).doc
  const response = await page.request.post('/api/posts', {
    data: {
      title: 'Restored Event editor',
      slug: `restored-event-${suffix}`,
      author: user.id,
      postType: type.id,
      _status: 'draft',
      postTypeValues: {
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
    'Event',
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
  await page.goto(`/${type.prefix}/${doc.slug}`)
  await expect(page.locator('.content-view')).toBeVisible()
})
