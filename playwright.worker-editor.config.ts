import { defineConfig } from '@playwright/test'

// This suite creates test content. It must never target the production database.
const baseURL = process.env.EDITOR_WORKER_URL || 'http://127.0.0.1:3104'
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
  throw new Error('Worker editor tests require an isolated local Worker')

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'content-workspace.e2e.spec.ts',
    'review-tasks.e2e.spec.ts',
    'editor-registration.e2e.spec.ts',
  ],
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  outputDir: '.wrangler/editor-worker-results',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    viewport: { width: 1800, height: 1100 },
    trace: 'off',
  },
})
