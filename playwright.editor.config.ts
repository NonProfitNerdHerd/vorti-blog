import { defineConfig } from '@playwright/test'
import path from 'node:path'

process.env.CONTENT_WORKSPACE_ENABLED = 'true'
process.env.E2E_TEST_PERSIST_PATH = path.resolve('.wrangler/content-workspace-test')
process.env.PAYLOAD_SECRET = 'local-editor-validation-only'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'content-workspace.e2e.spec.ts',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 1800, height: 1100 },
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm exec tsx tests/helpers/seedUser.cli.ts && pnpm exec next dev --webpack --port 3100',
    url: 'http://localhost:3100/admin/login',
    reuseExistingServer: process.env.EDITOR_TEST_REUSE === 'true',
    timeout: 180_000,
    env: {
      CONTENT_WORKSPACE_ENABLED: 'true',
      E2E_TEST_PERSIST_PATH: process.env.E2E_TEST_PERSIST_PATH,
      PAYLOAD_SECRET: process.env.PAYLOAD_SECRET,
    },
  },
})
