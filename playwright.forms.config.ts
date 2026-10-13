import { defineConfig, devices } from '@playwright/test'
const baseURL = process.env.FORM_LOCAL_ORIGIN || 'http://localhost:3105'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Forms browser tests require an isolated local server.')
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'forms.e2e.spec.ts', workers: 1, timeout: 90000,
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL, trace: 'retain-on-failure' },
  reporter: 'list', outputDir: '.wrangler/forms-browser-results',
})
