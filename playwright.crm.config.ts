import { defineConfig } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
const state = path.join(os.tmpdir(), 'vorticause-crm-expansion-browser')
const workerURL = process.env.CRM_WORKER_BASE_URL
if (workerURL && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(workerURL).hostname))
  throw new Error('CRM browser fixtures may only run against a local Worker.')
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'crm-expansion.e2e.spec.ts',
    'crm-opportunities.e2e.spec.ts',
    'crm-volunteers.e2e.spec.ts',
    'crm-correspondence.e2e.spec.ts',
    'crm-attachments.e2e.spec.ts',
  ],
  workers: 1,
  timeout: 360000,
  expect: { timeout: 30000 },
  reporter: 'list',
  use: {
    baseURL: workerURL || 'http://localhost:3124',
    viewport: { width: 1440, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    trace: 'off',
    actionTimeout: 30000,
    navigationTimeout: 120000,
  },
  webServer: workerURL
    ? undefined
    : {
        command:
          'node node_modules/tsx/dist/cli.mjs tests/helpers/seedCRMExpansion.cli.ts && node node_modules/next/dist/bin/next dev --webpack --port 3124',
        url: 'http://localhost:3124/admin/login',
        reuseExistingServer: false,
        timeout: 300000,
        env: {
          E2E_TEST_PERSIST_PATH: state,
          PAYLOAD_SECRET: 'local-crm-expansion-only-secret',
          ORGANIZATION_ADMIN_ENABLED: 'true',
        },
      },
})
