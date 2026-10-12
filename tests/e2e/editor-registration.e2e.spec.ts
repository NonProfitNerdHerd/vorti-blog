import { test, expect } from '@playwright/test'

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
