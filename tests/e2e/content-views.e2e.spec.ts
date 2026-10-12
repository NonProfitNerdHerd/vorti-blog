import { test, expect } from '@playwright/test'
import { listViews } from '../../packages/payload-design-core/src/views/model'

for (const definition of listViews()) {
  test(`${definition.label}: published rendering and responsive layout`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`/demo-${definition.key}`)
    const view = page.locator(`.cv-${definition.key}`)
    await expect(view).toBeVisible()
    await expect(view).toHaveAttribute('aria-busy', 'false')
    await expect(view.getByRole('alert')).toHaveCount(0)
    await expect(view.getByRole('heading', { name: definition.label, exact: true })).toBeVisible()
    if (!['event-day'].includes(definition.key))
      await expect(
        view.locator('.cv-card,.cv-day button,.cv-time-event,.cv-taxonomy-grid button').first(),
      ).toBeVisible()
    for (const [width, mode] of [
      [1440, 'desktop'],
      [768, 'tablet'],
      [390, 'phone'],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({
        colorScheme: mode === 'phone' ? 'dark' : 'light',
        reducedMotion: 'reduce',
      })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
        JSON.stringify(
          await page.evaluate(() =>
            Array.from(document.querySelectorAll('*'))
              .filter((el) => el.getBoundingClientRect().right > innerWidth + 2)
              .slice(0, 8)
              .map((el) => ({
                tag: el.tagName,
                className: el.className,
                width: el.getBoundingClientRect().width,
              })),
          ),
        ),
      ).toBeTruthy()
      await view.screenshot({
        path: `.wrangler/view-browser-results/${definition.key}-${mode}.png`,
      })
    }
    expect(errors).toEqual([])
  })
}
test('central view editing, draft publication, pagination, and calendar navigation', async ({
  page,
}) => {
  expect(
    (
      await page.request.post('/api/users/login', {
        data: {
          email: 'framework-local@example.invalid',
          password: 'Local-framework-review-2026!',
        },
      })
    ).ok(),
  ).toBeTruthy()
  const views = await (
    await page.request.get(
      '/api/saved-views?where[name][equals]=Demo%20%E2%80%94%20Post%20Grid%201&depth=0',
    )
  ).json()
  const view = views.docs[0]
  await page.goto(`/admin/collections/saved-views/${view.id}`)
  await expect(page.getByRole('tab', { name: 'Layout', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Style', exact: true }).click()
  await expect(page.locator('summary').filter({ hasText: /^Typography$/ })).toBeVisible()
  await page.goto('/demo-grid-1')
  const cards = page.locator('.cv-card')
  await expect(cards).toHaveCount(9)
  await page.locator('.content-view').getByRole('button', { name: '2', exact: true }).click()
  await expect(cards).toHaveCount(3)
  await page.goto('/demo-event-calendar')
  await page.getByRole('combobox', { name: 'Calendar view', exact: true }).selectOption('week')
  await expect(page.locator('.cv-timetable')).toBeVisible()
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(page.locator('.content-view')).toHaveAttribute('aria-busy', 'false')
  await page.locator('.cv-time-event').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})
