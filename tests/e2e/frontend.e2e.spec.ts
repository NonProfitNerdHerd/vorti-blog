import { test, expect } from '@playwright/test'

test.describe('Public frontend', () => {
  test('renders one public shell around unchanged page content', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await expect(page.locator('header')).toHaveCount(1)
    await expect(page.locator('footer')).toHaveCount(1)
    await expect(page.locator('main')).toHaveCount(1)
  })

  test('shows the public homepage and Posts archive', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await expect(page.locator('h1')).toContainText('Vorti')
    await expect(page.getByRole('link', { name: 'Explore all posts' })).toBeVisible()

    await page.goto('http://localhost:3000/posts')
    await expect(page.getByRole('heading', { name: 'Posts', exact: true })).toBeVisible()
  })

  test('returns 404 for missing Page and Post slugs', async ({ page }) => {
    const missingPage = await page.goto('http://localhost:3000/no-such-public-page')
    expect(missingPage?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

    const missingPost = await page.goto('http://localhost:3000/posts/no-such-public-post')
    expect(missingPost?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })
})
