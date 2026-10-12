import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['content-views.e2e.spec.ts'],
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  use: {
    baseURL: 'http://localhost:3102',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium',
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
  },
  outputDir: '.wrangler/view-browser-results',
})
