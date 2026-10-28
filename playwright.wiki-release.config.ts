import { defineConfig } from '@playwright/test'
const baseURL = process.env.WIKI_TEST_BASE_URL || 'http://localhost:3184'
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
  throw Error('Wiki mutation acceptance requires an isolated local Worker.')
export default defineConfig({
  metadata: {
    artifactHash: process.env.VORTI_ARTIFACT_HASH || '',
    sourceCommit: process.env.VORTI_SOURCE_COMMIT || '',
  },
  testDir: './tests/e2e',
  testMatch: ['wiki-release.e2e.spec.ts', 'tenant-release.e2e.spec.ts'],
  grep: /Wiki|shared login/,
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 30000 },
  outputDir: '.wrangler/wiki-release/browser-output',
  reporter: [['list'], ['json', { outputFile: '.wrangler/wiki-release/browser-results.json' }]],
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    viewport: { width: 1500, height: 1000 },
    trace: 'retain-on-failure',
  },
})
