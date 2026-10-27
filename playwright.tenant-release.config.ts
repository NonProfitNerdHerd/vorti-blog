import { defineConfig } from '@playwright/test'
const baseURL = process.env.TENANT_TEST_BASE_URL || 'http://localhost:3126'
if (!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname)) throw Error('Tenant acceptance creates synthetic content and requires an isolated local Worker.')
export default defineConfig({
  metadata: {artifactHash: process.env.VORTI_ARTIFACT_HASH || '', sourceCommit: process.env.VORTI_SOURCE_COMMIT || ''},
  testDir:'./tests/e2e',
  testMatch:['primary-publication.e2e.spec.ts','tenant-release.e2e.spec.ts','task-workspace.e2e.spec.ts','projects-workspace.e2e.spec.ts','workspace-starter.e2e.spec.ts','compact-workspace.e2e.spec.ts','board-refinement.e2e.spec.ts','board-overview.e2e.spec.ts','compact-columns.e2e.spec.ts','personal-dashboard.e2e.spec.ts','crm-tasks.e2e.spec.ts'],
  workers:1,timeout:300000,expect:{timeout:60000},retries:0,
  outputDir:'.wrangler/permissions-release/browser-results',reporter:[['list'],['json',{outputFile:'.wrangler/permissions-release/browser-results.json'}]],
  use:{baseURL,actionTimeout:60000,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',viewport:{width:1500,height:1000},trace:'retain-on-failure'},
})
