import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/users/login', {
    data: { email: 'dev@payloadcms.com', password: 'test' },
  })
  expect(response.ok()).toBeTruthy()
})

test('availability failures and stale checks never lock typing or unlock later steps', async ({
  page,
}) => {
  let fail = true
  await page.route('**/api/post-types?limit=1&depth=0&draft=true&where*', async (route) => {
    const key = new URL(route.request().url()).searchParams.get('where[key][equals]')
    if (fail) return route.fulfill({ status: 503, body: '{}' })
    if (key === 'taken') await new Promise((resolve) => setTimeout(resolve, 900))
    await route.fulfill({ json: { totalDocs: key === 'taken' ? 1 : 0 } })
  })
  await page.goto('/admin/collections/post-types/create')
  const key = page.locator('input[name="key"]')
  await key.fill('INVALID')
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await page.waitForTimeout(1000)
  await expect(page).toHaveURL(/post-types\/create$/)
  await expect(key).toBeEnabled()
  await key.fill('available')
  await expect(page.getByRole('button', { name: 'Retry availability check' })).toBeVisible()
  await expect(key).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeHidden()
  fail = false
  await page.getByRole('button', { name: 'Retry availability check' }).click()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible()
  await key.fill('taken')
  await expect(page.getByText('This key is already in use.')).toBeVisible()
  await key.fill('replacement')
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible()
  await key.fill('taken')
  await page.waitForTimeout(450)
  await key.fill('replacement-two')
  await page.waitForTimeout(1200)
  await expect(key).toHaveValue('replacement-two')
  await expect(key).toBeFocused()
  await expect(page.getByText('This key is already in use.')).toBeHidden()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: '1. Key', exact: true }).click()
  await key.fill('INVALID')
  await expect(page.getByRole('button', { name: '2. Names', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '3. Web address', exact: true })).toBeDisabled()
})
test('guided setup preserves fields, selects Calendar, validates previews and reopens saved types', async ({
  page,
}) => {
  const stamp = Date.now()
  await page.goto('/admin/collections/post-types/create')
  await expect(page.getByRole('heading', { name: 'Step 1: Key' })).toBeVisible()
  const key = page.locator('input[name="key"]')
  await key.pressSequentially('Example', { delay: 180 })
  await page.waitForTimeout(1200)
  await expect(key).toBeEnabled()
  await expect(key).toBeFocused()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '2. Names', exact: true })).toBeDisabled()
  await key.press('ControlOrMeta+A')
  await key.pressSequentially(`wizard-${stamp}`, { delay: 100 })
  await key.press('Backspace')
  await key.pressSequentially(String(stamp).slice(-1))
  await expect(key).toHaveValue(`wizard-${stamp}`)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.locator('input[name="singular"]').pressSequentially('Workshop', { delay: 180 })
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeHidden()
  await page.locator('input[name="plural"]').pressSequentially(`Workshops ${stamp}`, { delay: 100 })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.locator('input[name="prefix"]').fill('admin')
  await expect(page.getByText('This URL prefix is reserved.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Use plural name as URL prefix' }).click()
  await expect(page.locator('input[name="prefix"]')).toHaveValue(`workshops-${stamp}`)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('combobox', { name: 'Behavior', exact: true }).selectOption('event')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search icons' }).fill('calendar')
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.locator('.pt-field-list')).toContainText('Event schedule')
  await expect(page.getByRole('button', { name: 'Remove field', exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Field type', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Required for publication', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  await page.getByLabel('Label', { exact: true }).fill('Contact email')
  await page.getByRole('button', { name: 'Suggest ID from label' }).click()
  await page.getByRole('combobox', { name: 'Add rule', exact: true }).selectOption('email')
  await page.getByLabel('Required for publication', { exact: true }).check()
  await page.getByRole('button', { name: 'Save Field', exact: true }).click()
  await expect(page.getByText('Applied to setup—save the Post Type to persist.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Add rule', exact: true }).selectOption('minLength')
  await page.getByRole('button', { name: 'Update Field', exact: true }).click()
  await expect(page.getByLabel('Field issues', { exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'These settings need attention' })).toBeVisible()
  await expect(page.getByLabel('Post Type save errors', { exact: true })).toContainText(
    'Contact email',
  )
  await expect(page.getByLabel('Post Type save errors', { exact: true })).toBeFocused()
  await expect(page).toHaveURL(/post-types\/create$/)
  await page.getByRole('button', { name: '5. Icon', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Step 6: Fields' })).toBeVisible()
  const trash = page.getByRole('button', { name: 'Delete Minimum length rule', exact: true })
  await trash.click()
  const dialog = page.getByRole('dialog', { name: 'Delete rule?' })
  await expect(dialog).toContainText('Minimum length')
  await expect(dialog).toContainText('Contact email')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Delete rule', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trash).toBeFocused()
  await trash.click()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(trash).toBeFocused()
  await trash.click()
  await dialog.getByRole('button', { name: 'Delete rule', exact: true }).click()
  await expect(trash).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Delete Valid email address rule', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Add rule', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Duplicate field', exact: true }).click()
  await expect(page.locator('.pt-field-list')).toContainText('Contact email copy')
  await page.getByRole('button', { name: 'Remove field', exact: true }).click()
  await page.getByRole('button', { name: 'Update Field', exact: true }).click()
  await page.getByRole('button', { name: 'Show author form preview' }).click()
  await page
    .locator('.pt-preview')
    .getByLabel(/^Contact email/)
    .fill('not-email')
  await expect(page.locator('.pt-preview')).toContainText('Valid email address')
  await page
    .locator('.pt-preview')
    .getByLabel(/^Contact email/)
    .fill('review@example.org')
  await expect(page.locator('.pt-preview')).not.toContainText('Valid email address')
  await page.getByRole('button', { name: '7. Templates', exact: true }).click()
  await expect(page.getByText(/Templates control the full-page presentation/)).toBeVisible()
  await page.getByRole('button', { name: '8. Review', exact: true }).click()
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  await page.waitForURL(/post-types\/\d+/)
  const saved = await (
    await page.request.get(`/api/post-types/${page.url().split('/').at(-1)}?draft=true`)
  ).json()
  expect(saved.icon).toBe('lucide:Calendar')
  expect(saved.fieldDefinitions).toHaveLength(2)
  expect(saved.fieldDefinitions[1].rules).toEqual([{ kind: 'email' }])
  expect(saved).not.toHaveProperty('sample')
  await page.reload()
  await expect(page.locator('input[name="key"]')).toBeDisabled()
  await page.getByRole('button', { name: '2. Names', exact: true }).click()
  await page.locator('input[name="singular"]').press('End')
  await page.locator('input[name="singular"]').pressSequentially(' updated', { delay: 180 })
  await page.waitForTimeout(1000)
  await expect(page.locator('input[name="singular"]')).toBeEnabled()
  await page.getByRole('button', { name: '6. Fields', exact: true }).click()
  await page
    .locator('.pt-field-list')
    .getByRole('button', { name: /^Contact email/ })
    .click()
  await expect(page.getByLabel('Field ID', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove field', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Publish changes', exact: true }).click()
  await expect
    .poll(
      async () => (await (await page.request.get('/api/post-types/' + saved.id)).json())._status,
    )
    .toBe('published')
  await page.screenshot({ path: '.wrangler/post-type-fields-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  // Payload closes desktop navigation during its responsive transition.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBeTruthy()
  await page.screenshot({ path: '.wrangler/post-type-fields-mobile.png', fullPage: true })
})

test('publication rules reject direct API publication but allow unfinished drafts', async ({
  page,
}) => {
  const stamp = Date.now()
  const definition = await page.request.post('/api/post-types', {
    data: {
      key: `rules-${stamp}`,
      prefix: `rules-${stamp}`,
      singular: 'Rule example',
      plural: 'Rule examples',
      capability: 'content',
      _status: 'published',
      fieldDefinitions: [
        { id: 'start', label: 'Start', kind: 'date' },
        {
          id: 'end',
          label: 'End',
          kind: 'date',
          rules: [{ kind: 'compare', field: 'start', operator: 'after', allowEqual: true }],
        },
        { id: 'email', label: 'Email', kind: 'text', rules: [{ kind: 'email' }] },
      ],
    },
  })
  expect(definition.ok(), await definition.text()).toBeTruthy()
  const type = (await definition.json()).doc.id
  const data = {
    title: 'Rules example',
    author: (await (await page.request.get('/api/users/me')).json()).user.id,
    slug: `rules-${stamp}`,
    postType: type,
    postTypeValues: { start: '2026-10-12T12:00', end: '2026-10-12T11:00', email: 'invalid' },
    contentLayout: { version: 1, nodes: [] as never[] },
  }
  const draft = await page.request.post('/api/posts?draft=true', {
    data: { ...data, _status: 'draft' },
  })
  expect(draft.ok(), await draft.text()).toBeTruthy()
  const id = (await draft.json()).doc.id
  const invalid = await page.request.patch(`/api/posts/${id}`, { data: { _status: 'published' } })
  expect(invalid.status()).toBe(400)
  expect(await invalid.text()).toContain('postTypeValues.end')
  const valid = await page.request.patch(`/api/posts/${id}`, {
    data: {
      _status: 'published',
      postTypeValues: {
        ...data.postTypeValues,
        end: data.postTypeValues.start,
        email: 'a@example.org',
      },
    },
  })
  expect(valid.ok(), await valid.text()).toBeTruthy()
  const laterDraft = await page.request.patch(`/api/posts/${id}?draft=true`, {
    data: { _status: 'draft', postTypeValues: data.postTypeValues },
  })
  expect(laterDraft.ok(), await laterDraft.text()).toBeTruthy()
  const live = await (await page.request.get(`/api/posts/${id}`)).json()
  expect(live.postTypeValues.email).toBe('a@example.org')
  const invalidDefinition = await page.request.patch(`/api/post-types/${type}`, {
    data: {
      fieldDefinitions: [
        { id: 'start', label: 'Start', kind: 'date' },
        {
          id: 'end',
          label: 'End',
          kind: 'date',
          rules: [{ kind: 'compare', field: 'email', operator: 'after' }],
        },
        { id: 'email', label: 'Email', kind: 'text' },
      ],
    },
  })
  expect(invalidDefinition.status()).toBe(400)
  expect(await invalidDefinition.text()).toContain('matching field type')
})

test('existing type is read-only for editors and wizard stays usable in dark mode', async ({
  page,
  browser,
}) => {
  const stamp = Date.now()
  const typeResponse = await page.request.post('/api/post-types', {
    data: {
      key: `readonly-${stamp}`,
      prefix: `readonly-${stamp}`,
      singular: 'Read only example',
      plural: 'Read only examples',
      capability: 'content',
      _status: 'published',
      fieldDefinitions: [],
    },
  })
  expect(typeResponse.ok()).toBeTruthy()
  const type = (await typeResponse.json()).doc.id
  const email = `type-editor-${stamp}@example.invalid`
  const user = await page.request.post('/api/users', {
    data: { email, password: 'local-test-password', role: 'editor' },
  })
  expect(user.ok()).toBeTruthy()
  const context = await browser.newContext({
    baseURL: process.env.EDITOR_WORKER_URL || 'http://127.0.0.1:3104',
    colorScheme: 'dark',
  })
  const editor = await context.newPage()
  expect(
    (
      await editor.request.post('/api/users/login', {
        data: { email, password: 'local-test-password' },
      })
    ).ok(),
  ).toBeTruthy()
  const denied = await editor.request.patch(`/api/post-types/${type}`, {
    data: { singular: 'Forged' },
  })
  expect(denied.status()).toBe(403)
  await editor.goto(`/admin/collections/post-types/${type}`)
  await editor.getByRole('button', { name: '2. Names', exact: true }).click()
  await expect(editor.locator('input[name=singular]')).toBeDisabled()
  await editor.getByRole('button', { name: '6. Fields', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Add field', exact: true })).toBeDisabled()
  await editor.screenshot({ path: '.wrangler/post-type-readonly-dark.png', fullPage: true })
  await context.close()
})
