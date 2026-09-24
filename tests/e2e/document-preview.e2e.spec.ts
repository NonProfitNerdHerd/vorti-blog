import { test, expect } from '@playwright/test'
import { login } from '../helpers/login'
import { testUser } from '../helpers/seedUser'

const content = { root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [
  { type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', children: [
    { type: 'text', text: 'Preview test content', format: 0, mode: 'normal', style: '', detail: 0, version: 1 },
  ] },
] } }

for (const collection of ['posts', 'pages']) {
  test(`${collection}: opens published and draft content in new tabs and requires saving edits`, async ({ page, browser }) => {
    test.setTimeout(180_000)
    await login({ page, user: testUser })
    const api = page.context().request
    const me = await (await api.get('http://localhost:3000/api/users/me')).json()
    const slug = `preview-actions-${collection}-${Date.now()}`
    const prefix = collection === 'posts' ? '/posts/' : '/'
    const result = await api.post(`http://localhost:3000/api/${collection}`, { data: {
      title: 'Published preview test', slug, content, author: me.user.id, _status: 'published',
    } })
    expect(result.ok(), await result.text()).toBe(true)
    const { doc } = await result.json()
    try {
      const draft = await api.patch(`http://localhost:3000/api/${collection}/${doc.id}?draft=true`, {
        data: { title: 'Saved draft preview test', slug: `${slug}-draft`, _status: 'draft' },
      })
      expect(draft.ok(), await draft.text()).toBe(true)
      await page.goto(`http://localhost:3000/admin/collections/${collection}/${doc.id}`)
      const live = page.getByRole('link', { name: 'View live', exact: true })
      const preview = page.getByRole('link', { name: 'Preview', exact: true })
      await expect(live).toHaveAttribute('href', `${prefix}${slug}`)
      await expect(live).toHaveAttribute('target', '_blank')
      const liveTabPromise = page.waitForEvent('popup')
      await live.click()
      const liveTab = await liveTabPromise
      await expect(liveTab.getByRole('heading', { name: 'Published preview test', exact: true })).toBeVisible()
      await liveTab.close()

      await expect(preview).toHaveAttribute('target', '_blank')
      const previewTabPromise = page.waitForEvent('popup')
      await preview.click()
      const previewTab = await previewTabPromise
      await expect(previewTab.getByRole('heading', { name: 'Saved draft preview test', exact: true })).toBeVisible()
      const previewURL = previewTab.url()
      await previewTab.close()

      const anonymous = await browser.newContext()
      try {
        const response = await anonymous.request.get(previewURL)
        expect(response.status()).toBe(404)
      } finally { await anonymous.close() }

      await page.locator('input[name="title"]').fill('Unsaved edit')
      await expect(page.getByText('Save a draft to preview changes.', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Preview', exact: true })).toHaveCount(0)
      await expect(live).toHaveAttribute('href', `${prefix}${slug}`)
      await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
      await expect(preview).toBeVisible()
      const updatedTabPromise = page.waitForEvent('popup')
      await preview.click()
      const updatedTab = await updatedTabPromise
      await expect(updatedTab.getByRole('heading', { name: 'Unsaved edit', exact: true })).toBeVisible()
      await updatedTab.close()
    } finally { await api.delete(`http://localhost:3000/api/${collection}/${doc.id}`) }
  })
}
