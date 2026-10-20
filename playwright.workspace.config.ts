import { defineConfig } from '@playwright/test'
import path from 'node:path'

const persist =
  process.env.WORKSPACE_TEST_PERSIST_PATH ||
  path.resolve(`.wrangler/tasks-workspace-browser-${Date.now()}`)
process.env.WORKSPACE_TEST_PERSIST_PATH = persist
process.env.E2E_TEST_PERSIST_PATH = persist
process.env.PAYLOAD_SECRET = 'local-workspace-browser-only'
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'task-workspace.e2e.spec.ts',
    'projects-workspace.e2e.spec.ts',
    'workspace-starter.e2e.spec.ts',
    'compact-workspace.e2e.spec.ts',
    'board-refinement.e2e.spec.ts',
    'board-overview.e2e.spec.ts',
    'compact-columns.e2e.spec.ts',
    'vorticause.e2e.spec.ts',
    'personal-dashboard.e2e.spec.ts',
    'menus.e2e.spec.ts',
    'post-templates.e2e.spec.ts',
  ],
  workers: 1,
  timeout: 300000,
  expect: { timeout: 60000 },
  use: {
    baseURL: process.env.WORKSPACE_TEST_BASE_URL || 'http://localhost:3118',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    viewport: { width: 1500, height: 1000 },
    trace: 'off',
  },
  webServer:
    process.env.WORKSPACE_TEST_EXTERNAL === 'true'
      ? undefined
      : {
          command: `corepack pnpm exec tsx tests/helpers/seedWorkspace.cli.ts && corepack pnpm exec cross-env DESIGN_CORE_TEST_PERSIST_PATH="${persist}" corepack pnpm exec next dev --webpack --port 3118`,
          url: 'http://localhost:3118/admin/login',
          reuseExistingServer: true,
          timeout: 180000,
          env: { E2E_TEST_PERSIST_PATH: persist, PAYLOAD_SECRET: process.env.PAYLOAD_SECRET },
        },
})
